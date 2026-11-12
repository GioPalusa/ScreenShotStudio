import paper from 'paper';
import { convertFigmaFrame } from '../app/js/figma-layout.js';
import { shapePathData } from '../app/js/shape-boolean.js';
import { vectorMatrix } from '../app/js/vector-path.js';

// Clipboard boolean nodes can omit derived geometry while including their operands.
// Compute in the boolean's local space; the regular converter applies its parent transform.
export function resolveClipboardBoolean(node) {
  if (node.type !== 'BOOLEAN_OPERATION' || node.fillGeometry?.length || node.strokeGeometry?.length) return;
  const operation = { UNION: 'unite', SUBTRACT: 'subtract', INTERSECT: 'intersect', XOR: 'exclude' }[node.booleanOperation];
  if (!operation) throw Error(`“${node.name}”: unsupported copied boolean operation.`);
  const scope = new paper.PaperScope(); new scope.Project();
  function geometryOnly(source) {
    const copy = { ...source, opacity: 1, effects: [], strokes: [], children: source.children?.filter(child => child.visible !== false).map(geometryOnly) };
    // Boolean geometry does not depend on each operand having its own paint.
    if (!['GROUP', 'FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(copy.type)) copy.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    return copy;
  }
  try {
    const operands = (node.children ?? []).filter(child => child.visible !== false).map(child => {
      const design = convertFigmaFrame(geometryOnly(child), { minSize: 1 });
      let operand;
      for (const layer of design.layers) {
        if (layer.type !== 'shape') throw Error(`“${node.name}”: copied boolean operands must contain vector shapes.`);
        let item;
        for (const path of shapePathData(layer)) {
          const piece = new scope.CompoundPath({ pathData: path.d, insert: false }); piece.fillRule = path.rule ?? 'nonzero';
          item = item ? item.unite(piece, { insert: false }) : piece;
        }
        if (!item) continue;
        const basis = layer.shape === 'path' ? layer : { ...layer, pathSize: [layer.w, layer.h], pathOffset: [0, 0] };
        item.transform(new scope.Matrix(...vectorMatrix(basis)));
        const m = child.relativeTransform;
        if (m) item.transform(new scope.Matrix(m[0][0], m[1][0], m[0][1], m[1][1], m[0][2], m[1][2]));
        operand = operand ? operand.unite(item, { insert: false }) : item;
      }
      return operand;
    }).filter(Boolean);
    if (!operands.length) throw Error(`“${node.name}”: copied boolean operands are missing their geometry.`);
    let result = operands[0];
    for (const operand of operands.slice(1)) result = result[operation](operand, { insert: false });
    if (result.isEmpty() || Math.abs(result.area) < 1e-8) {
      node.fillGeometry = []; node.fills = []; node.strokes = [];
    } else node.fillGeometry = [{ path: result.getPathData(null, 8), windingRule: 'NONZERO' }];
  } finally { scope.project.remove(); }
}
