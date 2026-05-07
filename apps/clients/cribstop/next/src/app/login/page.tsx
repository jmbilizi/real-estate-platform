import { redirect } from "next/navigation";

export default function LoginPage() {
  redirect("/?modal=login");
}
