import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // Clean in dependency order
  await p.contactTag.deleteMany();
  await p.interaction.deleteMany();
  await p.eventAttendee.deleteMany();
  await p.reminder.deleteMany();
  await p.need.deleteMany();
  await p.event.deleteMany();
  await p.tag.deleteMany();
  await p.contact.deleteMany();

  const friends = await p.tag.create({
    data: { name: '朋友', color: '#10b981' },
  });
  const colleagues = await p.tag.create({
    data: { name: '同事', color: '#3b82f6' },
  });
  const investor = await p.tag.create({
    data: { name: '投资人', color: '#f59e0b' },
  });

  const zhang = await p.contact.create({
    data: {
      name: '张三',
      company: 'Acme Inc.',
      city: '北京',
      birthdayMonth: 6,
      birthdayDay: 14,
      tags: { create: [{ tagId: friends.id }] },
    },
  });

  const li = await p.contact.create({
    data: {
      name: '李四',
      company: 'Globex Corp.',
      city: '上海',
      birthdayMonth: 7,
      birthdayDay: 1,
      tags: { create: [{ tagId: colleagues.id }] },
    },
  });

  const wang = await p.contact.create({
    data: {
      name: '王五',
      company: '创业科技有限公司',
      city: '北京',
      tags: { create: [{ tagId: investor.id }] },
    },
  });

  const event = await p.event.create({
    data: {
      title: '咖啡约见 — 张三',
      startAt: new Date(Date.now() + 3 * 86_400_000),
      location: '三里屯',
      attendees: { create: [{ contactId: zhang.id }] },
    },
  });

  await p.event.create({
    data: {
      title: '周会 — 李四',
      type: 'meeting',
      startAt: new Date(Date.now() + 7 * 86_400_000),
      location: '腾讯会议',
      attendees: { create: [{ contactId: li.id }] },
    },
  });

  await p.need.create({
    data: {
      title: '找前端工程师',
      category: '合作',
      description: '需要 3 年以上 React + TypeScript 经验，负责核心产品开发',
      priority: 5,
    },
  });

  await p.need.create({
    data: {
      title: '介绍投资人',
      category: '介绍',
      description: '种子轮，SaaS 方向，已有 MVP',
      contactId: wang.id,
      status: 'matched',
    },
  });

  await p.need.create({
    data: {
      title: '请教 AI 落地经验',
      category: '咨询',
      priority: 3,
    },
  });

  await p.interaction.create({
    data: {
      contactId: zhang.id,
      occurredAt: new Date(Date.now() - 7 * 86_400_000),
      channel: '微信',
      summary: '聊了产品方向和下半年规划，张有兴趣参与',
    },
  });

  await p.interaction.create({
    data: {
      contactId: li.id,
      occurredAt: new Date(Date.now() - 3 * 86_400_000),
      channel: '电话',
      summary: '确认下周会议安排',
    },
  });

  console.log('Seeded successfully');
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
