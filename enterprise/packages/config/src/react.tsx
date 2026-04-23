import * as React from "react";
import { loadBrand, loadFeatures } from "./loaders";
import { BrandConfig, DEFAULT_BRAND_CONFIG, DEFAULT_FEATURE_FLAGS, FeatureFlags } from "./schemas";

const BrandContext = React.createContext<BrandConfig>(DEFAULT_BRAND_CONFIG);
const FeaturesContext = React.createContext<FeatureFlags>(DEFAULT_FEATURE_FLAGS);

export type ConfigProviderProps = {
  children: React.ReactNode;
  brandPath?: string;
  featuresPath?: string;
  initialBrand?: BrandConfig;
  initialFeatures?: FeatureFlags;
};

export function ConfigProvider({
  children,
  brandPath,
  featuresPath,
  initialBrand = DEFAULT_BRAND_CONFIG,
  initialFeatures = DEFAULT_FEATURE_FLAGS,
}: ConfigProviderProps) {
  const [brand, setBrand] = React.useState<BrandConfig>(initialBrand);
  const [features, setFeatures] = React.useState<FeatureFlags>(initialFeatures);

  React.useEffect(() => {
    let mounted = true;
    if (!brandPath && !process.env.NEXT_PUBLIC_BRAND_CONFIG) {
      return;
    }
    loadBrand(brandPath)
      .then((next) => {
        if (mounted) setBrand(next);
      })
      .catch(() => {
        if (mounted) setBrand(DEFAULT_BRAND_CONFIG);
      });
    return () => {
      mounted = false;
    };
  }, [brandPath]);

  React.useEffect(() => {
    let mounted = true;
    if (!featuresPath && !process.env.NEXT_PUBLIC_FEATURES_CONFIG) {
      return;
    }
    loadFeatures(featuresPath)
      .then((next) => {
        if (mounted) setFeatures(next);
      })
      .catch(() => {
        if (mounted) setFeatures(DEFAULT_FEATURE_FLAGS);
      });
    return () => {
      mounted = false;
    };
  }, [featuresPath]);

  return (
    <BrandContext.Provider value={brand}>
      <FeaturesContext.Provider value={features}>{children}</FeaturesContext.Provider>
    </BrandContext.Provider>
  );
}

export function useBrand(): BrandConfig {
  return React.useContext(BrandContext);
}

export function useFeatures(): FeatureFlags {
  return React.useContext(FeaturesContext);
}

