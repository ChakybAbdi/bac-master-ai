import type { ReactNode } from 'react';
import type {
  ChangeStatus,
  ClaimVerdict,
  EventStatus,
  Priority,
  Provenance,
  RowState,
  Verification,
} from '@shared/types.ts';
import { useI18n } from '@/lib/i18n.tsx';
import {
  IconAi,
  IconCircleCheck,
  IconCircleDashed,
  IconContradicted,
  IconMonitoring,
  IconOfficial,
  IconPartial,
  IconQuestion,
  IconUser,
  IconVerified,
} from './icons.ts';
import { cx } from './ui.tsx';

// Colour only ever encodes how far something can be trusted. Each badge also
// carries an icon and a label, so the meaning never depends on colour alone.
type Tone = 'ok' | 'warn' | 'bad' | 'teach' | 'accent' | 'neutral' | 'dashed';

const TONES: Record<Tone, string> = {
  ok: 'border-ok-line bg-ok-soft text-ok',
  warn: 'border-warn-line bg-warn-soft text-warn',
  bad: 'border-bad-line bg-bad-soft text-bad',
  teach: 'border-teach-line bg-teach-soft text-teach',
  accent: 'border-accent-line bg-accent-soft text-accent',
  neutral: 'border-line bg-panel text-muted',
  dashed: 'border-dashed border-line-strong bg-transparent text-muted',
};

export function Badge({
  tone,
  icon,
  title,
  children,
  className,
}: {
  tone: Tone;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle text-xs font-medium whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const VERIFICATION: Record<Verification, { tone: Tone; icon: ReactNode }> = {
  VERIFIED: { tone: 'ok', icon: <IconVerified aria-hidden /> },
  PARTIALLY_VERIFIED: { tone: 'warn', icon: <IconPartial aria-hidden /> },
  UNVERIFIED: { tone: 'dashed', icon: <IconQuestion aria-hidden /> },
  CONTRADICTED: { tone: 'bad', icon: <IconContradicted aria-hidden /> },
};

export function VerificationBadge({ level }: { level: Verification }) {
  const { t } = useI18n();
  const { tone, icon } = VERIFICATION[level];
  return (
    <Badge tone={tone} icon={icon} title={t.verificationHelp[level]}>
      {t.verification[level]}
    </Badge>
  );
}

const PROVENANCE: Record<Provenance, { tone: Tone; icon: ReactNode }> = {
  OFFICIAL: { tone: 'ok', icon: <IconOfficial aria-hidden /> },
  TEACHER_REVIEWED: { tone: 'teach', icon: <IconUser aria-hidden /> },
  AI_GENERATED: { tone: 'accent', icon: <IconAi aria-hidden /> },
  UNVERIFIED: { tone: 'dashed', icon: <IconQuestion aria-hidden /> },
};

export function ProvenanceBadge({ value }: { value: Provenance }) {
  const { t } = useI18n();
  const { tone, icon } = PROVENANCE[value];
  return (
    <Badge tone={tone} icon={icon}>
      {t.provenance[value]}
    </Badge>
  );
}

/** A monitoring status line ("nothing announced yet"): not an official text, not a rumour. */
export function WatchBadge() {
  const { t } = useI18n();
  return (
    <Badge tone="neutral" icon={<IconMonitoring aria-hidden />}>
      {t.provenance.watch}
    </Badge>
  );
}

export function ChangeBadge({ status }: { status: ChangeStatus }) {
  const { t } = useI18n();
  const tone: Tone = status === 'SUPERSEDED' ? 'dashed' : status === 'UNVERIFIED' ? 'dashed' : 'neutral';
  return <Badge tone={tone}>{t.change[status]}</Badge>;
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const { t } = useI18n();
  if (status === 'CONFIRMED') {
    return (
      <Badge tone="ok" icon={<IconCircleCheck aria-hidden />}>
        {t.eventStatus.CONFIRMED}
      </Badge>
    );
  }
  if (status === 'PROVISIONAL') return <Badge tone="warn">{t.eventStatus.PROVISIONAL}</Badge>;
  return (
    <Badge tone="dashed" icon={<IconCircleDashed aria-hidden />}>
      {t.eventStatus.NOT_ANNOUNCED}
    </Badge>
  );
}

export function VerdictBadge({ verdict }: { verdict: ClaimVerdict }) {
  const { t } = useI18n();
  return (
    <Badge tone={verdict === 'CONTRADICTED' ? 'bad' : 'dashed'} icon={<IconQuestion aria-hidden />}>
      {t.verdict[verdict]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useI18n();
  const tone: Tone = priority === 'CRITICAL' ? 'bad' : priority === 'HIGH' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{t.priority[priority]}</Badge>;
}

export function RowStateBadge({ state }: { state: RowState }) {
  const { t } = useI18n();
  const tone: Tone = state === 'PUBLISHED' ? 'ok' : state === 'PROVISIONAL' ? 'warn' : 'dashed';
  return <Badge tone={tone}>{t.admin.academic.state[state]}</Badge>;
}
