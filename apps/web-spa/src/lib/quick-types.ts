export type QuickKind = 'event' | 'action' | 'interaction' | 'note';

export interface ParsedQuick {
  kind: QuickKind;
  kind_score: number;
  due: string | null;
  contact_id: string | null;
  contact_match_score: number;
  summary: string;
  raw: string;
  confidence: number;
}