import { useEffect, useState } from 'react';

import { api, ApiClientError, type Order, type PaymentSettings } from '../../lib/api.js';
import { useBuilderStore } from '../../store/builderStore.js';

function formatAmount(unitAmount: number, currency: string): string {
  return `${(unitAmount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

const STATUS_LABEL: Record<Order['status'], string> = {
  pending: 'En attente',
  paid: 'Payee',
  failed: 'Echouee',
  expired: 'Expiree',
};

/**
 * Panneau « Boutique » : connexion du compte Stripe du proprietaire (jamais
 * celui de Crea — voir services/payments.ts cote API) et suivi des ventes.
 * Autonome, comme MediaPicker : il charge ses propres donnees plutot que de
 * passer par le store de l arbre, puisqu il ne touche pas l AST.
 */
export function PaymentsPanel(): React.ReactElement {
  const projectId = useBuilderStore((state) => state.projectId);

  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setLoading(true);
    Promise.all([api.getPaymentSettings(projectId), api.listOrders(projectId)])
      .then(([payments, { orders: list }]) => {
        if (!active) return;
        setSettings(payments.settings);
        setWebhookUrl(payments.webhookUrl);
        setOrders(list);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof ApiClientError ? cause.message : 'Boutique indisponible.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const connect = async (): Promise<void> => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      const { settings: next } = await api.savePaymentSettings(projectId, {
        publicKey: publicKey.trim(),
        secretKey: secretKey.trim(),
        webhookSecret: webhookSecret.trim(),
      });
      setSettings(next);
      setSecretKey('');
      setWebhookSecret('');
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Connexion impossible.');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      await api.disconnectPayments(projectId);
      setSettings({ configured: false, publicKey: null });
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Deconnexion impossible.');
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) return <div className="flex-1 p-3" />;

  if (loading) {
    return <p className="p-4 text-[13px] text-muted">Chargement de la boutique…</p>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <p className="mb-3 px-1 text-[11px] leading-relaxed text-muted">
        Ajoutez un bloc « Produit » a une page, puis connectez votre compte Stripe ici : le
        paiement est encaisse directement sur votre compte, Crea ne le touche jamais.
      </p>

      {error && (
        <p className="mb-3 rounded-lg border border-[#E0C4BB] bg-[#FBEFEC] px-3 py-2 text-[12px] text-[#8C3F2C]">
          {error}
        </p>
      )}

      <section className="mb-4 rounded-lg border border-line bg-white p-3">
        <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          Compte Stripe
        </h3>

        {settings?.configured ? (
          <div className="space-y-2">
            <p className="text-[13px] text-ink">
              Connecte — cle publique{' '}
              <code className="rounded bg-linen px-1 py-0.5 text-[11px]">{settings.publicKey}</code>
            </p>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={saving}
              className="crea-btn crea-btn-ghost w-full"
            >
              Deconnecter Stripe
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <label className="block">
              <span className="crea-label">Cle publique</span>
              <input
                className="crea-input"
                value={publicKey}
                placeholder="pk_live_…"
                onChange={(event) => setPublicKey(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="crea-label">Cle secrete</span>
              <input
                className="crea-input"
                type="password"
                value={secretKey}
                placeholder="sk_live_…"
                onChange={(event) => setSecretKey(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="crea-label">Secret de signature du webhook</span>
              <input
                className="crea-input"
                type="password"
                value={webhookSecret}
                placeholder="whsec_…"
                onChange={(event) => setWebhookSecret(event.target.value)}
              />
            </label>
            <p className="text-[11px] leading-relaxed text-muted">
              Les trois se trouvent dans le tableau de bord Stripe (Developpeurs → Cles API,
              puis Webhooks → ajouter une adresse ci-dessous).
            </p>
            <button
              type="button"
              onClick={() => void connect()}
              disabled={saving || !publicKey.trim() || !secretKey.trim() || !webhookSecret.trim()}
              className="crea-btn crea-btn-primary w-full"
            >
              {saving ? 'Connexion…' : 'Connecter Stripe'}
            </button>
          </div>
        )}

        <div className="mt-3 border-t border-line pt-3">
          <span className="crea-label">Adresse du webhook a coller dans Stripe</span>
          <div className="flex gap-1.5">
            <input readOnly value={webhookUrl} className="crea-input truncate text-[11px]" />
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(webhookUrl)}
              className="crea-btn crea-btn-ghost shrink-0 px-3"
            >
              Copier
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          Commandes ({orders.length})
        </h3>
        {orders.length === 0 ? (
          <p className="px-1 text-[12px] text-muted">Aucune vente pour le moment.</p>
        ) : (
          <ul className="space-y-1.5">
            {orders.map((order) => (
              <li key={order.id} className="rounded-lg border border-line bg-white p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">{order.productName}</span>
                  <span className="shrink-0 text-[13px] font-semibold text-forest">
                    {formatAmount(order.unitAmount, order.currency)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                  <span className="truncate">
                    {order.customerEmail ?? order.customerName ?? 'Acheteur non identifie'}
                  </span>
                  <span
                    className={
                      order.status === 'paid'
                        ? 'font-semibold text-sage'
                        : order.status === 'pending'
                          ? 'font-semibold text-gold'
                          : 'font-semibold text-[#B4553F]'
                    }
                  >
                    {STATUS_LABEL[order.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
