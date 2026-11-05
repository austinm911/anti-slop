export function Label(props: { text: string }) @{
  <span>{props.text}</span>
}

export function Guarded(props: { text: string }) @{
  if (!props.text) return
  <span>{props.text}</span>
}

export function mixed(value: boolean) {
  if (value) return 1
}
