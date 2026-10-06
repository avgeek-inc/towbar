export const ThemeImage = ({
  light,
  dark,
  alt,
  width,
  height,
  sizes,
  priority = false,
}) => (
  <>
    <div className="oss-product-light">
      <img
        src={light}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
      />
    </div>
    <div className="oss-product-dark">
      <img
        src={dark || light}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
      />
    </div>
  </>
);
export const Screenshot = ({
  light,
  dark,
  alt,
  caption,
  width,
  height,
  sizes,
  portrait = false,
}) => (
  <figure
    className={
      portrait
        ? "oss-doc-screenshot oss-doc-screenshot-portrait"
        : "oss-doc-screenshot"
    }
  >
    <div className="oss-product-light">
      <img
        src={light}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        loading="lazy"
      />
    </div>
    <div className="oss-product-dark">
      <img
        src={dark || light}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        loading="lazy"
      />
    </div>
    {caption ? <figcaption>{caption}</figcaption> : null}
  </figure>
);
