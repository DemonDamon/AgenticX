type Props = {
  text: string;
};

export function SystemNotice({ text }: Props) {
  return <div className="py-1 text-center text-[11px] text-text-faint">{text}</div>;
}
