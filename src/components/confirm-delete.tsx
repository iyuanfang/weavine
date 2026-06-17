'use client';

export function ConfirmDeleteForm({
  action,
  children,
}: {
  action: (fd: FormData) => Promise<unknown>;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={(e) => {
        if (!confirm('确认删除？')) {
          e.preventDefault();
        }
      }}
      action={action}
    >
      {children}
    </form>
  );
}
