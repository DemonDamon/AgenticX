import * as React from "react";
import { Button, Textarea } from "@agenticx/ui";

type InputAreaProps = {
  value: string;
  status: "idle" | "sending" | "streaming" | "error";
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
};

export function InputArea({ value, status, onChange, onSend, onCancel }: InputAreaProps) {
  const canSend = status !== "sending" && status !== "streaming" && value.trim().length > 0;
  const canCancel = status === "sending" || status === "streaming";

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="Type a message..."
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (event.shiftKey) return;
          event.preventDefault();
          if (canSend) onSend();
        }}
      />
      <div className="flex items-center gap-2">
        <Button onClick={onSend} disabled={!canSend}>
          Send
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={!canCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

