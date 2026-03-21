'use client';
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { brandingApi, BrandingConfig } from '@/lib/api';
import { getPartnerId } from '@/lib/utils';

const DEFAULTS: BrandingConfig = {
  primaryColor: '#6366f1',
  accentColor: '#4f46e5',
  logoUrl: '',
  platformName: 'BusinessX',
  tagline: '',
};

interface ThemeContextValue {
  branding: BrandingConfig;
  platformBranding: BrandingConfig;
  refresh: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  branding: DEFAULTS,
  platformBranding: DEFAULTS,
  refresh: async () => {},
});

function applyBranding(platform: BrandingConfig, partner: BrandingConfig) {
  const primary = partner.primaryColor || platform.primaryColor || DEFAULTS.primaryColor!;
  const accent = partner.accentColor || platform.accentColor || DEFAULTS.accentColor!;
  document.documentElement.style.setProperty('--brand', primary);
  document.documentElement.style.setProperty('--brand-dark', accent);
  // Update browser tab title
  const name = platform.platformName || DEFAULTS.platformName!;
  if (document.title !== name) document.title = name;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [platformBranding, setPlatformBranding] = useState<BrandingConfig>(DEFAULTS);
  const [partnerBranding, setPartnerBranding] = useState<BrandingConfig>({});

  const refresh = useCallback(async () => {
    try {
      const partnerId = getPartnerId();
      const requests: Promise<unknown>[] = [brandingApi.getPlatform()];
      if (partnerId) requests.push(brandingApi.getPartner(partnerId));

      const [platRes, partRes] = await Promise.all(requests) as [{ data: { data: BrandingConfig } }, { data: { data: BrandingConfig } } | undefined];

      const plat = platRes?.data?.data ?? {};
      const partner = partRes?.data?.data ?? {};
      setPlatformBranding(plat);
      setPartnerBranding(partner);
      applyBranding(plat, partner);
    } catch {
      // silently fall back to CSS defaults
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ThemeContext.Provider value={{ branding: partnerBranding, platformBranding, refresh }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
