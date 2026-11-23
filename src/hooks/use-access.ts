import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess, type MyAccess } from "@/lib/access.functions";

const FALLBACK: MyAccess = {
  user_id: "",
  is_admin: false,
  company_restricted: true,
  can_download_sheets: false,
  can_push_bling: false,
  can_use_ai: false,
  active: true,
  access_expires_at: null,
  expired: false,
};

export function useAccess() {
  const fn = useServerFn(getMyAccess);
  const q = useQuery({
    queryKey: ["my-access"],
    queryFn: () => fn({}),
    staleTime: 60_000,
  });
  return { access: (q.data as MyAccess | undefined) ?? FALLBACK, isLoading: q.isLoading };
}
