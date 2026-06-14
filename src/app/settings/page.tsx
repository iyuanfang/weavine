import { PushToggle } from '@/components/push-toggle';
import { readSettings, writeSettings } from './actions';

export default async function SettingsPage() {
  const s = await readSettings();

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">设置</h1>

      <form action={writeSettings} className="space-y-4 rounded border p-4 text-sm">
        <div>
          <label className="block">
            提醒提前时间（分钟，多个用逗号分隔）
          </label>
          <input
            name="reminderOffsets"
            defaultValue={s.reminderOffsets.join(',')}
            className="input-base mt-1 w-full"
          />
        </div>

        <div>
          <label className="block">
            久未联系阈值（天，多个用逗号分隔）
          </label>
          <input
            name="staleDays"
            defaultValue={s.staleDays.join(',')}
            className="input-base mt-1 w-full"
          />
        </div>

        <div>
          <label className="block">主色调</label>
          <input
            name="accent"
            type="color"
            defaultValue={s.accent}
          />
        </div>

        <button className="btn-primary">保存</button>
      </form>

      <section className="rounded border p-4">
        <h2 className="font-semibold">浏览器通知</h2>
        <div className="mt-2">
          <PushToggle />
        </div>
      </section>
    </main>
  );
}
