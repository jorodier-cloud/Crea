import type { CalendarContent, FormContent } from '@crea/schema';

/**
 * Apercus non interactifs des blocs composites.
 * Ils refletent visuellement la projection HTML produite par `renderTreeToHtml`.
 */

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function CalendarPreview({ content }: { content: CalendarContent }): React.ReactElement {
  const months = Math.max(1, Math.min(content.monthsVisible ?? 2, 4));
  const blocked = new Set(content.blockedDates ?? []);
  const today = new Date();

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, width: '100%' }}>
      {Array.from({ length: months }, (_, offset) => {
        const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth();
        const label = new Intl.DateTimeFormat(content.locale || 'fr-FR', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(cursor);
        const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

        return (
          <div key={`${year}-${month}`} style={{ minWidth: 210, flex: '1 1 210px' }}>
            <p
              style={{
                margin: '0 0 8px',
                fontWeight: 600,
                textTransform: 'capitalize',
                fontSize: 14,
              }}
            >
              {label}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 3,
                fontSize: 12,
              }}
            >
              {WEEKDAYS.map((weekday, index) => (
                <span key={`${weekday}-${index}`} style={{ opacity: 0.5, textAlign: 'center' }}>
                  {weekday}
                </span>
              ))}
              {Array.from({ length: firstWeekday }, (_, index) => (
                <span key={`empty-${index}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const day = index + 1;
                const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
                const isBlocked = blocked.has(iso);
                return (
                  <span
                    key={iso}
                    style={{
                      textAlign: 'center',
                      padding: '5px 0',
                      borderRadius: 5,
                      opacity: isBlocked ? 0.3 : 1,
                      textDecoration: isBlocked ? 'line-through' : 'none',
                      background: isBlocked ? 'rgba(0,0,0,.05)' : 'transparent',
                    }}
                  >
                    {day}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <p style={{ margin: 0, fontSize: 13, opacity: 0.7, width: '100%' }}>
        Sejour minimum : {content.minNights ?? 1} nuits
        {content.icalUrls.length > 0 ? ` — ${content.icalUrls.length} flux iCal` : ''}
      </p>
    </div>
  );
}

export function FormPreview({ content }: { content: FormContent }): React.ReactElement {
  return (
    <>
      {(content.fields ?? []).map((field) => (
        <div key={field.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <span
            style={{
              display: 'block',
              minHeight: field.type === 'textarea' ? 78 : 40,
              border: '1px solid #DDD6C7',
              borderRadius: 8,
              background: '#fff',
              padding: '11px 13px',
              fontSize: 14,
              color: '#9AA096',
            }}
          >
            {field.placeholder ?? ''}
          </span>
        </div>
      ))}
      <span
        style={{
          alignSelf: 'flex-start',
          padding: '11px 24px',
          borderRadius: 999,
          background: '#2F4132',
          color: '#fff',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {content.submitLabel || 'Envoyer'}
      </span>
    </>
  );
}
