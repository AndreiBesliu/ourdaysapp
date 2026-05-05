import { useEffect } from 'react';

export function useModalBack(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;

    // Push a new state when the modal opens
    window.history.pushState({ modal: true }, '');

    const handlePopState = (e: PopStateEvent) => {
      // If the back button is pressed, the state we pushed is popped.
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      
      // If the modal is closing NOT by the popstate (e.g., user clicked X),
      // we need to clean up the history stack so the user doesn't have to 
      // press back twice later.
      if (window.history.state?.modal) {
        window.history.back();
      }
    };
  }, [isOpen, onClose]);
}
