export const DashboardService = {
  async snapshot() {
    return { contacts: 0, activeNeeds: 0, unreadInbox: 0, upcomingBirthdays: [] as { id: string; name: string; when: Date }[] };
  },
};
