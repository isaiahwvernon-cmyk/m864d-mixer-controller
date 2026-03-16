import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Monitor } from "lucide-react";

interface ServerInfo {
  lanIP: string;
  port: number;
  url: string;
}

export default function ConnectPage() {
  const { data: info, isLoading } = useQuery<ServerInfo>({
    queryKey: ["/api/info"],
    refetchInterval: 10000,
  });

  const isLocalhost =
    !info || info.lanIP === "localhost" || info.lanIP === "127.0.0.1";
  const displayUrl = info?.url ?? "Loading…";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-10"
      style={{
        background: "#0b1120",
        backgroundImage:
          "repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(0,180,224,0.025) 3px, rgba(0,180,224,0.025) 4px)",
        color: "#d0e6f4",
      }}
      data-testid="connect-page"
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-7">

        {/* Header */}
        <div className="text-center">
          <div
            className="mx-auto flex items-center justify-center font-black rounded-2xl mb-4"
            style={{
              width: 56, height: 56, fontSize: 24,
              background: "rgba(0,180,224,0.12)",
              border: "1px solid rgba(0,180,224,0.3)",
              color: "#00b4e0",
              boxShadow: "0 0 28px rgba(0,180,224,0.15)",
            }}
          >
            M
          </div>
          <div
            className="font-mono font-bold uppercase"
            style={{ fontSize: 13, color: "#d0e6f4", letterSpacing: "0.35em" }}
          >
            M-864D
          </div>
          <div
            className="font-mono mt-1"
            style={{ fontSize: 10, color: "#4a637d", letterSpacing: "0.18em" }}
          >
            Digital Stereo Mixer
          </div>
        </div>

        {/* QR / placeholder */}
        {isLoading ? (
          <div
            className="rounded-2xl animate-pulse"
            style={{ width: 220, height: 220, background: "#1a2540" }}
          />
        ) : isLocalhost ? (
          <div
            className="rounded-2xl flex flex-col items-center justify-center gap-3 text-center px-6"
            style={{
              width: 220, height: 220,
              background: "#111827",
              border: "1px solid #22344e",
              color: "#4a637d",
            }}
          >
            <Monitor size={36} />
            <p className="text-sm leading-snug font-mono">
              No LAN address detected.<br />
              Open <strong style={{ color: "#8bafc6" }}>localhost:5000</strong><br />
              in your browser.
            </p>
          </div>
        ) : (
          <div
            className="p-3 rounded-2xl"
            style={{ background: "#ffffff", boxShadow: "0 0 40px rgba(0,180,224,0.2)" }}
            data-testid="qr-code"
          >
            <QRCodeSVG
              value={info!.url}
              size={220}
              bgColor="#ffffff"
              fgColor="#0b1120"
              level="M"
              includeMargin={false}
            />
          </div>
        )}

        {/* Network address */}
        <div className="text-center">
          <p
            className="font-mono uppercase"
            style={{ fontSize: 8, color: "#4a637d", letterSpacing: "0.22em", marginBottom: 6 }}
          >
            Network address
          </p>
          <p
            className="font-mono font-bold break-all select-all"
            style={{ fontSize: 17, color: "#00b4e0", letterSpacing: "0.04em" }}
            data-testid="network-url"
          >
            {displayUrl}
          </p>
        </div>

        {/* Instructions */}
        <div
          className="w-full rounded-2xl px-5 py-4 font-mono"
          style={{
            background: "#111827",
            border: "1px solid #22344e",
            fontSize: 11,
            color: "#4a637d",
            lineHeight: 1.7,
            letterSpacing: "0.02em",
          }}
        >
          <ol className="list-decimal list-inside space-y-1">
            <li>Make sure the device is on the same Wi-Fi or network.</li>
            <li>Scan the QR code <em>or</em> type the address above into any browser.</li>
            <li>Enter the M-864D mixer IP address to connect and control.</li>
          </ol>
        </div>

        {/* Open locally */}
        <a
          href="/"
          className="font-mono uppercase"
          style={{ fontSize: 9, color: "#4a637d", letterSpacing: "0.18em", textDecoration: "underline" }}
          data-testid="button-open-controller"
        >
          Open controller on this device →
        </a>
      </div>
    </div>
  );
}
