export const Home = ({ children, ...props }) => (
  <div {...props} className="oss-home">
    {children}
  </div>
);
export const Hero = ({ id, children }) => (
  <section className="oss-hero" aria-labelledby={id}>
    {children}
  </section>
);
export const Actions = ({ children }) => (
  <div className="oss-actions">{children}</div>
);
// Uses Mintlify's native header CTA markup and utility classes.
export const ActionLink = ({ variant = "primary", children, ...props }) => (
  <a
    {...props}
    data-oss-action={variant}
    className="group pl-3 pr-2 py-2 relative inline-flex items-center text-sm font-medium"
  >
    <span
      className="absolute inset-0 bg-primary-dark rounded-xl group-hover:opacity-[0.9]"
      aria-hidden="true"
    />
    <div className="z-10 gap-1 flex items-center">
      <span className="text-white">{children}</span>
    </div>
  </a>
);
export const InlineLink = ({ children, ...props }) => (
  <a {...props} className="oss-link">
    {children}
  </a>
);
export const Highlights = ({ children, ...props }) => (
  <section {...props} className="oss-highlights">
    {children}
  </section>
);
export const SectionIntro = ({ children }) => (
  <div className="oss-section-intro">{children}</div>
);
export const Eyebrow = ({ children }) => (
  <p className="oss-feature-label">{children}</p>
);
export const Process = ({ id, children }) => (
  <section className="oss-process" aria-labelledby={id}>
    {children}
  </section>
);
export const SplitSection = ({ id, children }) => (
  <section className="oss-ownership" aria-labelledby={id}>
    {children}
  </section>
);
export const Points = ({ children }) => (
  <div className="oss-ownership-points">{children}</div>
);
export const FeatureGroup = ({ children }) => (
  <div className="oss-features">{children}</div>
);
export const Feature = ({ id, children }) => (
  <section className="oss-feature" aria-labelledby={id}>
    {children}
  </section>
);
export const FeatureCopy = ({ children }) => (
  <div className="oss-feature-copy">{children}</div>
);
export const FeatureImage = ({ children }) => (
  <div className="oss-feature-image">{children}</div>
);
export const ProductFrame = ({ children }) => (
  <div className="oss-product">
    <div className="oss-product-frame">{children}</div>
  </div>
);
export const Spotlight = ({ id, children }) => (
  <section className="oss-spotlight" aria-labelledby={id}>
    {children}
  </section>
);
export const SpotlightIntro = ({ children }) => (
  <div className="oss-spotlight-intro">{children}</div>
);
