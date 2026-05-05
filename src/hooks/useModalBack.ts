import { useEffect, useRef } from 'react';

export function useModalBack(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  const modalIdRef = useRef<number | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    modalIdRef.current = Date.now() + Math.random();
    window.history.pushState({ modalId: modalIdRef.current }, '');

    const handlePopState = () => {
      onCloseRef.current();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      
      if (window.history.state?.modalId === modalIdRef.current) {
        window.history.back();
      }
    };
  }, [isOpen]);
}
