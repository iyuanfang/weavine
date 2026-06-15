import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const STATUS_MAP: Record<string, { status: string; completedAt: Date | null }> = {
  open: { status: 'open', completedAt: null },
  matched: { status: 'open', completedAt: null },
  in_progress: { status: 'open', completedAt: null },
  closed: { status: 'done', completedAt: null },
  cancelled: { status: 'dropped', completedAt: null },
};

async function main() {
  const needs = await p.need.findMany();
  console.log(`Found ${needs.length} needs to migrate`);

  if (needs.length === 0) {
    console.log('Nothing to migrate');
    return;
  }

  let created = 0;
  for (const n of needs) {
    const mapped = STATUS_MAP[n.status] ?? { status: 'open', completedAt: null };
    await p.action.create({
      data: {
        title: n.title,
        description: n.description,
        status: mapped.status,
        priority: n.priority,
        category: n.category,
        contactId: n.contactId,
        completedAt: n.closedAt ?? mapped.completedAt,
        createdAt: n.createdAt,
      },
    });
    created++;
  }

  console.log(`Migrated ${created} needs → actions`);
  console.log('\nStatus mapping:');
  console.log('  open / matched / in_progress → open');
  console.log('  closed → done (completedAt from closedAt)');
  console.log('  cancelled → dropped');
  console.log('\nNeed table is preserved for 30 days. To drop:');
  console.log('  1. Remove from prisma/schema.prisma');
  console.log('  2. pnpm exec prisma db push --accept-data-loss');
  console.log('  3. Delete src/app/needs/, src/app/api/needs/, src/server/services/need.ts');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
