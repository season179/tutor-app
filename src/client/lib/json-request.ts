export function jsonRequestInit(method: "PATCH" | "POST", body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json"
    },
    method
  };
}
