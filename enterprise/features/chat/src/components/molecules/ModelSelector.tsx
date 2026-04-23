import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agenticx/ui";

type ModelSelectorProps = {
  value: string;
  options: string[];
  onChange: (model: string) => void;
};

export function ModelSelector({ value, options, onChange }: ModelSelectorProps) {
  return (
    <div className="w-56">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {options.map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

