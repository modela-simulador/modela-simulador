declare module "polygon-splitter" {
  import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
  type SplitterPolygonInput = Polygon | MultiPolygon | Feature<Polygon | MultiPolygon>;
  type SplitterLineInput = LineString | MultiLineString | Feature<LineString | MultiLineString>;
  function polygonSplitter(
    polygon: SplitterPolygonInput | Geometry,
    line: SplitterLineInput | Geometry
  ): FeatureCollection;
  export default polygonSplitter;
}
