import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Mail, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeMyPassword, sendLoginCode, verifyLoginCode } from "@/lib/account-security.functions";
import { signInAfterPasswordChange } from "@/lib/security-gate";
import type { SecurityState } from "@/lib/account-security.functions";
import { PASSWORD_MIN_LENGTH, passwordPolicyIssues } from "@/lib/password-policy";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";
}

export function LoginCodeStep({ state, onVerified, onCancel }: {
  state: SecurityState;
  onVerified: (state: SecurityState) => void;
  onCancel: () => void;
}) {
  const send = useServerFn(sendLoginCode);
  const verify = useServerFn(verifyLoginCode);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState(state.code_email);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [wait, setWait] = useState(0);
  const sentOnce = useRef(false);

  async function requestCode() {
    setSending(true);
    try {
      const result = await send();
      if (result.code_email) setEmail(result.code_email);
      if (result.sent) toast.success("Código enviado. Confira sua caixa de entrada e o spam.");
      setWait(60);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    if (!state.pending_code) void requestCode();
    else setWait(60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    try {
      const next = await verify({ data: { code } });
      onVerified(next);
    } catch (error) {
      toast.error(errorText(error));
      setCode("");
    } finally {
      setChecking(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Enviamos um código de 6 números para <strong>{email || "o e-mail da conta"}</strong>. Ele vale por 10 minutos.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-code">Código de verificação</Label>
        <Input
          id="login-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="text-center text-lg tracking-[0.5em]"
        />
      </div>
      <Button type="submit" className="w-full" disabled={checking || code.length !== 6}>
        {checking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Confirmar código
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Button type="button" variant="link" className="px-0" disabled={sending || wait > 0} onClick={requestCode}>
          {sending ? "Enviando…" : wait > 0 ? `Reenviar código em ${wait}s` : "Reenviar código"}
        </Button>
        <Button type="button" variant="link" className="px-0 text-muted-foreground" onClick={onCancel}>
          Sair
        </Button>
      </div>
    </form>
  );
}

export function PasswordRequirements({ password }: { password: string }) {
  const issues = passwordPolicyIssues(password);
  const items = [
    { label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`, ok: !issues.some((i) => i.startsWith("pelo menos")) },
    { label: "Uma letra", ok: !issues.includes("uma letra") },
    { label: "Um número", ok: !issues.includes("um número") },
    { label: "Um caractere especial (ex.: ! @ # $ %)", ok: !issues.some((i) => i.startsWith("um caractere especial")) },
  ];
  return (
    <ul className="space-y-1 text-xs">
      {items.map((item) => (
        <li key={item.label} className={item.ok && password ? "flex items-center gap-1.5 text-primary" : "flex items-center gap-1.5 text-muted-foreground"}>
          {item.ok && password ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function NewPasswordStep({ currentPassword, reason, onDone, onCancel }: {
  currentPassword?: string;
  reason: string;
  onDone: (state: SecurityState) => void;
  onCancel: () => void;
}) {
  const change = useServerFn(changeMyPassword);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = passwordPolicyIssues(password).length === 0 && password === confirmation;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmation) return toast.error("As senhas não conferem.");
    setSaving(true);
    try {
      const result = await change({ data: { new_password: password, current_password: currentPassword ?? current } });
      toast.success("Senha nova salva.");
      const next = await signInAfterPasswordChange(result.email, password);
      if (next) onDone(next);
      else onCancel();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>{reason}</p>
      </div>
      {!currentPassword && (
        <div className="space-y-2">
          <Label htmlFor="step-current">Senha atual</Label>
          <Input id="step-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="step-new">Senha nova</Label>
        <Input id="step-new" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordRequirements password={password} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="step-confirm">Repita a senha nova</Label>
        <Input id="step-confirm" type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={saving || !valid}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Salvar senha nova
      </Button>
      <Button type="button" variant="link" className="w-full text-muted-foreground" onClick={onCancel}>
        Sair
      </Button>
    </form>
  );
}
