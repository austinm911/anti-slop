// A JavaScript plugin in the shape @tsrx/oxc runs on .tsrx: a plain `{ meta, rules }`
// object with no runtime imports, so it never depends on a second Oxlint version.
const keyedMap = {
  meta: {
    type: "problem",
    messages: { missing: "JSX returned from .map() needs a `key` prop." },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "map") return;
        const returned = node.arguments[0]?.body;
        if (returned?.type !== "JSXElement") return;
        const keyed = returned.openingElement.attributes.some(
          (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "key",
        );
        if (!keyed) context.report({ node: returned, messageId: "missing" });
      },
    };
  },
};

// Pins how TSRX control flow reaches a rule: `@if` arrives as an IfStatement.
const controlFlow = {
  meta: { type: "suggestion", messages: { seen: "IfStatement" }, schema: [] },
  create(context) {
    return {
      IfStatement(node) {
        context.report({ node, messageId: "seen" });
      },
    };
  },
};

export default {
  meta: { name: "fixture" },
  rules: { "keyed-map": keyedMap, "control-flow": controlFlow },
};
