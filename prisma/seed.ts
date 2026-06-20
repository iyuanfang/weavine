import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const owner = await p.user.upsert({
    where: { wechatUnionId: 'seed-local' },
    create: {
      wechatUnionId: 'seed-local',
      name: '本地演示账号',
      isLocal: true,
    },
    update: {},
  });
  const ownerId = owner.id;

  await p.contactTag.deleteMany({ where: { ownerId } });
  await p.interaction.deleteMany({ where: { ownerId } });
  await p.reminder.deleteMany({ where: { ownerId } });
  await p.event.deleteMany({ where: { ownerId } });
  await p.tag.deleteMany({ where: { ownerId } });
  await p.contact.deleteMany({ where: { ownerId } });
  await p.action.deleteMany({ where: { ownerId } });

  const friends = await p.tag.create({
    data: { ownerId, name: '朋友', color: '#10b981' },
  });
  const colleagues = await p.tag.create({
    data: { ownerId, name: '同事', color: '#3b82f6' },
  });
  const investor = await p.tag.create({
    data: { ownerId, name: '投资人', color: '#f59e0b' },
  });

  const zhang = await p.contact.create({
    data: {
      ownerId,
      name: '老张',
      nickname: '张三',
      company: 'Acme Inc.',
      city: '北京',
      tags: { create: [{ ownerId, tagId: friends.id }] },
    },
  });

  const li = await p.contact.create({
    data: {
      ownerId,
      name: 'Lily',
      nickname: '李四',
      company: 'Globex Corp.',
      city: '上海',
      tags: { create: [{ ownerId, tagId: colleagues.id }] },
    },
  });

  const wang = await p.contact.create({
    data: {
      ownerId,
      nickname: '王五',
      name: null,
      company: '创业科技有限公司',
      city: '北京',
      tags: { create: [{ ownerId, tagId: investor.id }] },
    },
  });

  const event = await p.event.create({
    data: {
      ownerId,
      title: '咖啡约见 — 张三',
      startAt: new Date(Date.now() + 3 * 86_400_000),
      location: '三里屯',
      contactId: zhang.id,
    },
  });

  await p.event.create({
    data: {
      ownerId,
      title: '周会 — 李四',
      type: '会面',
      startAt: new Date(Date.now() + 7 * 86_400_000),
      location: '腾讯会议',
      contactId: li.id,
    },
  });

  await p.interaction.create({
    data: {
      ownerId,
      contactId: zhang.id,
      occurredAt: new Date(Date.now() - 7 * 86_400_000),
      channel: '微信',
      summary: '聊了产品方向和下半年规划，张有兴趣参与',
    },
  });

  await p.interaction.create({
    data: {
      ownerId,
      contactId: li.id,
      occurredAt: new Date(Date.now() - 3 * 86_400_000),
      channel: '电话',
      summary: '确认下周会议安排',
    },
  });

  console.log('Seeded successfully for owner:', ownerId);
  console.log({
    zhang: zhang.id,
    li: li.id,
    wang: wang.id,
    event: event.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
