import type { Role } from "./types";

const HOME: Record<Role, string> = {
  member: "/",
  admin: "/admin",
};

export function homeFor(role: Role): string {
  return HOME[role];
}
