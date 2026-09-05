import { useBuilderStore } from '../../store/builderStore.js';

/** Jauge de Points IA, connectee au solde du compte. */
export function PointsGauge(): React.ReactElement {
  const points = useBuilderStore((state) => state.points);
  const ceiling = useBuilderStore((state) => state.pointsCeiling);

  const ratio = ceiling > 0 ? Math.max(0, Math.min(points / ceiling, 1)) : 0;
  const percent = Math.round(ratio * 100);

  const tone = ratio > 0.4 ? 'bg-sage' : ratio > 0.15 ? 'bg-gold' : 'bg-[#B4553F]';

  return (
    <div className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          Points IA
        </span>
        <span className="font-display text-lg leading-none text-forest">
          {points.toLocaleString('fr-FR')}
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-linen"
        role="progressbar"
        aria-valuenow={points}
        aria-valuemin={0}
        aria-valuemax={ceiling}
        aria-label="Solde de points IA"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${tone}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="mt-1.5 text-[11px] text-muted">
        {points <= 0
          ? 'Solde epuise — le moteur IA est suspendu.'
          : `${percent}% du credit initial (${ceiling.toLocaleString('fr-FR')} pts)`}
      </p>
    </div>
  );
}
