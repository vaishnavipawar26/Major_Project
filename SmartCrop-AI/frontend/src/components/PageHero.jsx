/**
 * Page header on a photo: the title and one short line sit on a green gradient so the text stays
 * readable on any part of the image. The image has fixed proportions, so nothing jumps while it loads.
 */
export default function PageHero({ image, alt, title, children, actions }) {
  return (
    <section className="page-hero">
      <img className="page-hero-img" src={image} alt={alt} width="1400" height="620" decoding="async" />
      <div className="page-hero-overlay">
        <div className="page-hero-copy">
          <h1>{title}</h1>
          {children && <p>{children}</p>}
        </div>
        {actions}
      </div>
    </section>
  );
}
