import Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/themes/prism-tomorrow.css";

type Props = {
  code: string;
};

export function CodePreview({ code }: Props) {
  const highlighted = Prism.highlight(code || "# 暂无代码产物", Prism.languages.python, "python");
  return (
    <div className="h-full overflow-auto rounded-md border border-border bg-slate-950 p-3 text-xs">
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
