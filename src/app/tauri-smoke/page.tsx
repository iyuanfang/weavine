"use client";

import { useEffect, useState } from "react";
import { dataAccess } from "@/lib/data-access";
import { isTauri } from "@/lib/env";

export default function TauriSmokeTestPage() {
  const [status, setStatus] = useState<string>("Loading...");
  const [contactCount, setContactCount] = useState<number | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        if (!isTauri()) {
          setStatus("Not running in Tauri — web mode");
          return;
        }
        const ownerId = "local-user";
        const contacts = await dataAccess.listContacts({ ownerId });
        setContactCount(contacts.length);
        setStatus(`Tauri desktop OK — ${contacts.length} contacts found`);
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    run();
  }, []);

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Tauri Smoke Test</h1>
      <div className="space-y-2">
        <p>
          <strong>Environment:</strong> {isTauri() ? "Tauri Desktop" : "Web"}
        </p>
        <p>
          <strong>Status:</strong> {status}
        </p>
        {contactCount !== null && (
          <p>
            <strong>Contact count:</strong> {contactCount}
          </p>
        )}
      </div>
    </div>
  );
}
