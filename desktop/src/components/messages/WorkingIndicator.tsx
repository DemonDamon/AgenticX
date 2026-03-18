import { Spinner } from "../ds/Spinner";
import { Shimmer } from "../ds/Shimmer";

type Props = {
  text?: string;
};

export function WorkingIndicator({ text = "Thinking..." }: Props) {
  return (
    <div className="inline-flex items-center gap-2 text-xs text-text-subtle">
      <Spinner size="sm" />
      <Shimmer text={text} />
    </div>
  );
}
