import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X } from 'lucide-react';
import { t } from '../utils/i18n';
import { useThemeStore } from '../store';
import { reportError } from '../reportError';

interface BarcodeScannerProps {
  onScan: (result: string, format: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const { language } = useThemeStore();
  const [error, setError] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Always the latest callback, without making the camera effect depend on its identity.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    scannerRef.current = new Html5Qrcode("reader", {
      verbose: false,
      formatsToSupport: [
        0, // QR_CODE
        1, // AZTEC
        2, // CODABAR
        3, // CODE_39
        4, // CODE_93
        5, // CODE_128
        6, // DATA_MATRIX
        7, // MAXICODE
        8, // ITF
        9, // EAN_13
        10, // EAN_8
        11, // PDF_417
        12, // RSS_14
        13, // RSS_EXPANDED
        14, // UPC_A
        15, // UPC_E
        16 // UPC_EAN_EXTENSION
      ]
    });

    // Set by the cleanup below. `start()` can resolve AFTER the component is gone — the camera
    // permission prompt alone can take seconds — and by then nothing else will ever stop it.
    let cancelled = false;

    const startScanning = async () => {
      try {
        await scannerRef.current?.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText, decodedResult) => {
            // Success
            if (scannerRef.current) {
              scannerRef.current.stop().then(() => {
                onScanRef.current(decodedText, decodedResult.result.format?.formatName || 'UNKNOWN');
              }).catch(() => {
                // The scan itself succeeded; failing to release the camera must not swallow it.
                onScanRef.current(decodedText, decodedResult.result.format?.formatName || 'UNKNOWN');
              });
            }
          },
          () => {
            // Error is very frequent as it scans frames that don't have barcodes
            // Ignore for UX
          }
        );
        // Torn down while the camera was warming up: stop the stream we just opened. Without this
        // the guard in the cleanup had already run and found `isScanning` still false.
        if (cancelled) await scannerRef.current?.stop().catch(() => {});
      } catch (err: any) {
        if (cancelled) return; // an aborted start is not an error to show anybody
        reportError(err instanceof Error ? err.message : String(err), { context: 'BarcodeScanner.start' });
        setError(t('scannerCameraFailed', language));
      }
    };

    startScanning();

    return () => {
      cancelled = true;
      // Unconditional. `isScanning` is only true once getUserMedia has resolved, so gating on it
      // was exactly backwards: the one case that needed stopping was the one it skipped. Calling
      // stop() on an instance that never started rejects harmlessly, and that is caught.
      scannerRef.current?.stop().catch(() => {});
    };
    // `onScan` is an inline arrow at every call site, so a new identity on every parent render.
    // Keying the effect on it restarted the camera each time the parent re-rendered; the callback
    // is read through a ref instead so this effect runs once per mount.
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="p-4 flex justify-between items-center bg-black/50 absolute top-0 left-0 right-0 z-10">
        <h3 className="text-white font-medium">{t('scanBarcodeTitle', language)}</h3>
        <button onClick={onClose} className="p-2 text-white bg-white/20 rounded-full">
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center relative">
        <div id="reader" className="w-full max-w-md bg-black"></div>
      </div>
      {error && (
        <div className="absolute bottom-10 left-4 right-4 bg-red-500 text-white p-4 rounded-xl text-center">
          {error}
        </div>
      )}
      <div className="absolute bottom-10 left-0 right-0 text-center text-white/70 text-sm px-4">
        {t('scannerHint', language)}
      </div>
    </div>
  );
}
