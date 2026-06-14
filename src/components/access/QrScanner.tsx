import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export function QrCodeView({
  value,
  size = 192,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => setDataUrl(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  if (!dataUrl) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        aria-label="QR Code"
      />
    );
  }
  return <img src={dataUrl} alt="QR Code" width={size} height={size} className={className} />;
}

export function QrScanner({
  onScan,
  active,
}: {
  onScan: (value: string) => void;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    let cancelled = false;
    let instance: { stop: () => Promise<void>; clear: () => void } | null = null;
    (async () => {
      try {
        const mod = await import("html5-qrcode");
        const Html5Qrcode = mod.Html5Qrcode;
        if (cancelled) return;
        const elementId = "qr-scanner-container";
        if (containerRef.current) containerRef.current.id = elementId;
        const raw = new Html5Qrcode(elementId) as unknown as {
          start: (a: unknown, b: unknown, c: (t: string) => void) => Promise<void>;
          stop: () => Promise<void>;
          clear: () => void;
        };
        instance = raw;
        scannerRef.current = instance;
        await raw.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text: string) => onScan(text),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Câmera indisponível");
      }
    })();
    return () => {
      cancelled = true;
      const i = scannerRef.current as { stop?: () => Promise<void>; clear?: () => void } | null;
      if (i?.stop) i.stop().catch(() => undefined).finally(() => i.clear?.());
      scannerRef.current = null;
    };
  }, [active, onScan]);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="w-full max-w-sm aspect-square rounded-lg overflow-hidden bg-black"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
