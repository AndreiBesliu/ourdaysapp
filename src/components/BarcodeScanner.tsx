import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (result: string, format: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const [error, setError] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

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
                onScan(decodedText, decodedResult.result.format?.formatName || 'UNKNOWN');
              }).catch(err => {
                console.error("Failed to stop scanner", err);
                onScan(decodedText, decodedResult.result.format?.formatName || 'UNKNOWN');
              });
            }
          },
          () => {
            // Error is very frequent as it scans frames that don't have barcodes
            // Ignore for UX
          }
        );
      } catch (err: any) {
        console.error("Scanner Error:", err);
        setError("Could not start camera. Please ensure you have granted camera permissions.");
      }
    };

    startScanning();

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="p-4 flex justify-between items-center bg-black/50 absolute top-0 left-0 right-0 z-10">
        <h3 className="text-white font-medium">Scan Barcode / QR</h3>
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
        Position the barcode or QR code within the frame to scan automatically.
      </div>
    </div>
  );
}
