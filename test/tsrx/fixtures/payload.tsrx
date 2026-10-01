export type Payload = Record<string, unknown>;

export function Summary({ payload }: { payload: Payload }) @{
  <pre>{JSON.stringify(payload)}</pre>
}
