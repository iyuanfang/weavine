export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCron } = await import('./src/server/cron');
    startCron();
  }
}
