declare module "polygon-splitter" {
  import type { Feature, Geometry, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
  type SplitterPolygonInput = Polygon | MultiPolygon | Feature<Polygon | MultiPolygon>;
  type SplitterLineInput = LineString | MultiLineString | Feature<LineString | MultiLineString>;
  /**
   * Devuelve un Feature con geometría MultiPolygon donde cada coordenada
   * top-level (`geometry.coordinates[i]`) es uno de los polígonos resultantes
   * del corte. Si la línea no atravesó el polígono, devuelve un MultiPolygon
   * con una sola parte (igual al original).
   */
  function polygonSplitter(
    polygon: SplitterPolygonInput | Geometry,
    line: SplitterLineInput | Geometry
  ): Feature<MultiPolygon>;
  export default polygonSplitter;
}
