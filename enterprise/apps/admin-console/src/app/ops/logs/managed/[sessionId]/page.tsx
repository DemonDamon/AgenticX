"use client";

import { useParams } from "next/navigation";

import { ManagedSessionDetail } from "../../../../../components/managed-sessions/ManagedSessionDetail";

export default function ManagedSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <div className="min-h-screen bg-background px-6 pt-5 pb-6">
      <ManagedSessionDetail sessionId={sessionId} />
    </div>
  );
}
