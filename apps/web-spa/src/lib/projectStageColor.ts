export type StageKind = 'queued' | 'active' | 'pending' | 'closed';

const STAGE_KIND: Record<string, Record<string, StageKind>> = {
  general: {
    待启动: 'queued',
    进行中: 'active',
    待收尾: 'pending',
    已完成: 'closed',
  },
  sales: {
    线索: 'queued',
    商机: 'active',
    沟通: 'active',
    报价: 'pending',
    丢单: 'closed',
    中标: 'closed',
  },
  product_dev: {
    立项: 'queued',
    设计: 'active',
    开发: 'active',
    发布: 'pending',
    推广: 'active',
    终止: 'closed',
  },
};

const STAGE_COLORS: Record<StageKind, string> = {
  queued: '#94a3b8',
  active: '#10b981',
  pending: '#f59e0b',
  closed: '#6b7280',
};

export function stageKind(template: string, stage: string): StageKind {
  return STAGE_KIND[template]?.[stage] ?? 'queued';
}

export function stageColor(template: string, stage: string): string {
  return STAGE_COLORS[stageKind(template, stage)];
}

export interface StageBadgeStyle {
  background: string;
  color: string;
  border: string;
}

export function stageBadgeStyle(
  template: string,
  stage: string,
): StageBadgeStyle {
  const base = stageColor(template, stage);
  return {
    background: `${base}14`,
    color: base,
    border: `1px solid ${base}30`,
  };
}

export interface StageDotStyle {
  background: string;
}

export function stageDotStyle(
  template: string,
  stage: string,
): StageDotStyle {
  return { background: stageColor(template, stage) };
}