import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export default function LogoutButton() {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
        Log out
      </Button>
    </form>
  );
}
