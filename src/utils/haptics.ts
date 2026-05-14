import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { useThemeStore } from '../store';

export const triggerHaptic = async (style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light') => {
  if (!useThemeStore.getState().hapticsEnabled) return;

  try {
    if (style === 'light') await Haptics.impact({ style: ImpactStyle.Light });
    else if (style === 'medium') await Haptics.impact({ style: ImpactStyle.Medium });
    else if (style === 'heavy') await Haptics.impact({ style: ImpactStyle.Heavy });
    else if (style === 'success') await Haptics.notification({ type: NotificationType.Success });
    else if (style === 'warning') await Haptics.notification({ type: NotificationType.Warning });
    else if (style === 'error') await Haptics.notification({ type: NotificationType.Error });
  } catch (e) {
    // Ignore if not on a device supporting haptics or browser lacks support
  }
};
