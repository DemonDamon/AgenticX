type Props = {
  status: "idle" | "listening" | "processing";
  onToggle: () => void;
};

const colorMap = {
  idle: "#4ade80",
  listening: "#22d3ee",
  processing: "#f59e0b"
};

export function FloatingBall({ status, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        width: 58,
        height: 58,
        borderRadius: "50%",
        border: "none",
        background: colorMap[status],
        cursor: "pointer",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
      }}
      title={`AgenticX (${status})`}
    />
  );
}
