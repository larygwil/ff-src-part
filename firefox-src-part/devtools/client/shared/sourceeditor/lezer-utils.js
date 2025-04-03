/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
// These are all the current lezer node types used in the source editor,
// Add more here as are needed
const nodeTypes = {
  AssignmentExpression: "AssignmentExpression",
  FunctionExpression: "FunctionExpression",
  FunctionDeclaration: "FunctionDeclaration",
  ArrowFunction: "ArrowFunction",
  MethodDeclaration: "MethodDeclaration",
  ClassDeclaration: "ClassDeclaration",
  ClassExpression: "ClassExpression",
  Property: "Property",
  PropertyDeclaration: "PropertyDeclaration",
  PropertyDefinition: "PropertyDefinition",
  PrivatePropertyDefinition: "PrivatePropertyDefinition",
  MemberExpression: "MemberExpression",
  VariableDeclaration: "VariableDeclaration",
  VariableDefinition: "VariableDefinition",
  VariableName: "VariableName",
  this: "this",
  PropertyName: "PropertyName",
  Equals: "Equals",
  ParamList: "ParamList",
  Spread: "Spread",
  Number: "Number",
};

const functionsSet = new Set([
  nodeTypes.FunctionExpression,
  nodeTypes.FunctionDeclaration,
  nodeTypes.ArrowFunction,
  nodeTypes.MethodDeclaration,
]);

const nodeTypeSets = {
  functions: functionsSet,
  expressions: new Set([
    nodeTypes.MemberExpression,
    nodeTypes.VariableDefinition,
    nodeTypes.VariableName,
    nodeTypes.this,
    nodeTypes.PropertyName,
  ]),
  functionExpressions: new Set([
    nodeTypes.ArrowFunction,
    nodeTypes.FunctionExpression,
    nodeTypes.ParamList,
  ]),
  declarations: new Set([
    nodeTypes.MethodDeclaration,
    nodeTypes.PropertyDeclaration,
  ]),
  functionsDeclAndExpr: new Set([
    ...functionsSet,
    nodeTypes.Property,
    nodeTypes.PropertyDeclaration,
    nodeTypes.VariableDeclaration,
    nodeTypes.AssignmentExpression,
  ]),
  functionsVarDecl: new Set([
    ...functionsSet,
    // For anonymous functions we are using the variable name where the function is stored. See `getFunctionName`.
    nodeTypes.VariableDeclaration,
  ]),
  paramList: new Set([nodeTypes.ParamList]),
  variableDefinition: new Set([nodeTypes.VariableDefinition]),
  numberAndProperty: new Set([nodeTypes.PropertyDefinition, nodeTypes.Number]),
  memberExpression: new Set([nodeTypes.MemberExpression]),
  classes: new Set([nodeTypes.ClassDeclaration, nodeTypes.ClassExpression]),
  bindingReferences: new Set([
    nodeTypes.VariableDefinition,
    nodeTypes.VariableName,
  ]),
  expressionProperty: new Set([nodeTypes.PropertyName]),
};

const ast = new Map();

/**
 * Checks if a node has children with any of the node types specified
 *
 * @param {Object} node
 * @param {Set} types
 * @returns
 */
function hasChildNodeOfType(node, types) {
  let childNode = node.firstChild;
  while (childNode !== null) {
    if (types.has(childNode.name)) {
      return true;
    }
    childNode = childNode.nextSibling;
  }
  return false;
}

/**
 * Checks if a node has children with any of the node types specified
 *
 * @param {Object} node
 * @param {Set} types
 * @returns
 */
function findChildNodeOfType(node, types) {
  let childNode = node.firstChild;
  while (childNode !== null) {
    if (types.has(childNode.name)) {
      return childNode;
    }
    childNode = childNode.nextSibling;
  }
  return null;
}

/**
 * Gets a cached tree or parses the the source content
 *
 * @param {Object} parserLanguage - The language parser used to parse the source
 * @param {String} id - A unique identifier for the source
 * @param {String} content - The source text
 * @returns {Tree} - https://lezer.codemirror.net/docs/ref/#common.Tree
 */
function getTree(parserLanguage, id, content) {
  if (ast.has(id)) {
    return ast.get(id);
  }
  const tree = parserLanguage.parser.parse(content);
  ast.set(id, tree);
  return tree;
}

function clear() {
  ast.clear();
}

/**
 * Gets the node and the function name which immediately encloses the node (representing a location)
 *
 * @param {Object} doc - The codemirror document used to retrive the part of content
 * @param {Object} node - The parser syntax node https://lezer.codemirror.net/docs/ref/#common.SyntaxNode
 * @params {Object} options
 *                  options.includeAnonymousFunctions - if true, allow matching anonymous functions
 * @returns
 */
function getEnclosingFunction(
  doc,
  node,
  options = { includeAnonymousFunctions: false }
) {
  let parentNode = node.parent;
  while (parentNode !== null) {
    if (nodeTypeSets.functionsVarDecl.has(parentNode.name)) {
      // For anonymous functions, we use variable declarations, but we only care about variable declarations which are part of function expressions
      if (
        parentNode.name == nodeTypes.VariableDeclaration &&
        !hasChildNodeOfType(parentNode.node, nodeTypeSets.functionExpressions)
      ) {
        parentNode = parentNode.parent;
        continue;
      }
      const funcName = getFunctionName(doc, parentNode);
      if (funcName || options.includeAnonymousFunctions) {
        return {
          node: parentNode,
          funcName,
        };
      }
    }
    parentNode = parentNode.parent;
  }
  return null;
}

/**
 * Gets the node at the specified location
 *
 * @param {Object} doc - https://codemirror.net/docs/ref/#state.EditorState.doc
 * @param {Object} tree - https://lezer.codemirror.net/docs/ref/#common.Tree
 * @param {Object} location
 * @returns {Object} node - https://lezer.codemirror.net/docs/ref/#common.SyntaxNodeRef
 */
function getTreeNodeAtLocation(doc, tree, location) {
  try {
    const line = doc.line(location.line);
    const pos = line.from + location.column;
    return tree.resolve(pos, 1);
  } catch (e) {
    // if the line is not found in the document doc.line() will throw
    console.warn(e.message);
  }
  return null;
}

/**
 * Converts Codemirror position to valid source location. Used only for CM6
 *
 * @param {Object} doc - The Codemirror document used to retrive the part of content
 * @param {Number} pos - Codemirror offset
 * @returns
 */
function positionToLocation(doc, pos) {
  if (pos == null) {
    return {
      line: null,
      column: null,
    };
  }
  const line = doc.lineAt(pos);
  return {
    line: line.number,
    column: pos - line.from,
  };
}

/**
 * Gets the name of the function if any exists, returns null
 * for anonymous functions.
 *
 * @param {Object} doc - The codemirror document used to retrive the part of content
 * @param {Object} node - The parser syntax node https://lezer.codemirror.net/docs/ref/#common.SyntaxNode
 * @returns {String|null}
 */
function getFunctionName(doc, node) {
  /**
   * Examples:
   *  - Gets `foo` in `class ESClass { foo(a, b) {}}`
   *  - Gets `bar` in `class ESClass { bar = function () {}}`
   *  - Gets `boo` in `class ESClass { boo = () => {}}`
   *  - Gets `#pfoo` in `class ESClass { #pfoo() => {}}`
   */
  if (
    node.name == nodeTypes.MethodDeclaration ||
    (node.name == nodeTypes.PropertyDeclaration &&
      hasChildNodeOfType(node, nodeTypeSets.functionExpressions))
  ) {
    const propDefNode = findChildNodeOfType(
      node,
      new Set([
        nodeTypes.PropertyDefinition,
        nodeTypes.PrivatePropertyDefinition,
      ])
    );

    if (!propDefNode) {
      return null;
    }
    return doc.sliceString(propDefNode.from, propDefNode.to);
  } else if (
    /**
     * Examples:
     *  - Gets `foo` in `let foo = function () {};`
     *  - Gets `bar` in `const bar = () => {}`
     */
    node.name == nodeTypes.VariableDeclaration &&
    hasChildNodeOfType(node, nodeTypeSets.functionExpressions)
  ) {
    const varDefNode = findChildNodeOfType(
      node,
      nodeTypeSets.variableDefinition
    );

    if (!varDefNode) {
      return null;
    }
    return doc.sliceString(varDefNode.from, varDefNode.to);
  } else if (
    /**
     * Examples:
     *  - Gets `Foo` in `function Foo() {} - FunctionDeclaration`
     *  - Gets `bar` in `function bar(a) {} - Functionexpression`
     */
    node.name == nodeTypes.FunctionDeclaration ||
    node.name == nodeTypes.FunctionExpression
  ) {
    const varDefNode = findChildNodeOfType(
      node,
      nodeTypeSets.variableDefinition
    );

    if (!varDefNode) {
      return null;
    }
    return doc.sliceString(varDefNode.from, varDefNode.to);
  } else if (
    /**
     * Examples:
     *  - Gets `foo` in `const a = { foo(a, ...b) {} }`
     *  - Gets `bar` in `const a = { bar: function () {} }`
     *  - Gets `bla` in `const a = { bla: () => {} }`
     *  - Gets `1234` in `const a = { 1234: () => {} }`
     */
    node.name == nodeTypes.Property &&
    hasChildNodeOfType(node, nodeTypeSets.functionExpressions)
  ) {
    const propDefNode = findChildNodeOfType(
      node,
      nodeTypeSets.numberAndProperty
    );

    if (!propDefNode) {
      return null;
    }
    return doc.sliceString(propDefNode.from, propDefNode.to);
  } else if (
    /**
     * Examples:
     *  - Gets `bar` in `const foo = {}; foo.bar = function() {}`
     *  - Gets `bla` in `const foo = {}; foo.bla = () => {}`
     */
    node.name == nodeTypes.AssignmentExpression &&
    hasChildNodeOfType(node, nodeTypeSets.functionExpressions)
  ) {
    const memExprDefNode = findChildNodeOfType(
      node,
      nodeTypeSets.memberExpression
    );

    if (!memExprDefNode) {
      return null;
    }
    // Get the rightmost part of the member expression i.e for a.b.c get c
    const exprParts = doc
      .sliceString(memExprDefNode.from, memExprDefNode.to)
      .split(".");
    return exprParts.at(-1);
  }

  return null;
}

/**
 * Gets the parameter names of the function as an array
 *
 * @param {Object} doc - The codemirror document used to retrieve the part of content
 * @param {Object} node - The parser syntax node https://lezer.codemirror.net/docs/ref/#common.SyntaxNode
 * @returns {Array}
 */
function getFunctionParameterNames(doc, node) {
  // Find the parameter list node

  let exprNode = node;

  if (
    // Example: Gets `(a)` in `const foo = {}; foo.bar = function(a) {}`
    node.name == nodeTypes.AssignmentExpression ||
    // Example: Gets `(a, b)` in `let foo = function (a, b) {};`
    node.name == nodeTypes.VariableDeclaration ||
    // Example: Gets `(x, y)` in `class ESClass { bar = function (x, y) {}}`
    node.name == nodeTypes.PropertyDeclaration ||
    // Example: Gets `(foo, ...bar)` in `const a = { foo: (foo, ...bar) {}}`
    (node.name == nodeTypes.Property &&
      !hasChildNodeOfType(node, nodeTypeSets.paramList))
  ) {
    exprNode = findChildNodeOfType(node, nodeTypeSets.functionExpressions);
  }

  /**
   * Others
   *  Function Declarations - Gets `(x, y)` in `function Foo(x, y) {}`
   *  Method Declarations - Gets `(a, b)` in `class ESClass { foo(a, b) {}}`
   */
  const paramListNode = findChildNodeOfType(exprNode, nodeTypeSets.paramList);
  if (paramListNode == null) {
    return [];
  }

  const names = [];
  let currNode = paramListNode.firstChild; // "("
  // Get all the parameter names
  while (currNode !== null && currNode.name !== ")") {
    if (currNode.name == nodeTypes.VariableDefinition) {
      // ignore spread operators i.e foo(...x)
      if (currNode.prevSibling?.name !== nodeTypes.Spread) {
        names.push(doc.sliceString(currNode.from, currNode.to));
      }
    }
    currNode = currNode.nextSibling;
  }
  return names;
}

function getFunctionClass(doc, node) {
  /**
   * Examples (Class Methods and Properties):
   *  Gets `ESClass` in `class ESClass { foo(a, b) {}}`
   *  Gets `ESClass` in `class ESClass { bar = function () {}}`
   */
  if (!nodeTypeSets.declarations.has(node.name)) {
    return null;
  }
  return doc.sliceString(
    node.parent.prevSibling.from,
    node.parent.prevSibling.to
  );
}

/**
 * Gets the meta data for member expression nodes
 *
 * @param {Object} doc - The codemirror document used to retrieve the part of content
 * @param {Object} node - The parser syntax node https://lezer.codemirror.net/docs/ref/#common.SyntaxNode
 * @returns
 */
function getMetaBindings(doc, node) {
  if (!node || node.name !== nodeTypes.MemberExpression) {
    return null;
  }

  const memExpr = doc.sliceString(node.from, node.to).split(".");
  return {
    type: "member",
    start: positionToLocation(doc, node.from),
    end: positionToLocation(doc, node.to),
    property: memExpr.at(-1),
    parent: getMetaBindings(doc, node.parent),
  };
}

/**
 * Walk the syntax tree of the langauge provided
 *
 * @param {Object}   view - Codemirror view (https://codemirror.net/docs/ref/#view)
 * @param {Object}   language - Codemirror Language (https://codemirror.net/docs/ref/#language)
 * @param {Object}   options
 *        {Boolean}  options.forceParseTo - Force parsing the document up to a certain point
 *        {Function} options.enterVisitor - A function that is called when a node is entered
 *        {Set}      options.filterSet - A set of node types which should be visited, all others should be ignored
 *        {Number}   options.walkFrom - Determine the location in the AST where the iteration of the syntax tree should start
 *        {Number}   options.walkTo - Determine the location in the AST where the iteration of the syntax tree should end
 */
async function walkTree(view, language, options) {
  const { forceParsing, syntaxTree } = language;
  if (options.forceParseTo) {
    // Force parsing the source, up to the end of the current viewport,
    // Also increasing the timeout threshold so we make sure
    // all required content is parsed (this is mostly needed for larger sources).
    await forceParsing(view, options.forceParseTo, 10000);
  }
  await syntaxTree(view.state).iterate({
    enter: node => {
      if (options.filterSet?.has(node.name)) {
        options.enterVisitor(node);
      }
    },
    from: options.walkFrom,
    to: options.walkTo,
  });
}

/**
 * This enables walking a specific part of the syntax tree using the cursor
 * provided by the node (which is the parent)
 * @param {Object} cursor - https://lezer.codemirror.net/docs/ref/#common.TreeCursor
 * @param {Object} options
 *        {Function} options.enterVisitor - A function that is called when a node is entered
 *        {Set}      options.filterSet - A set of node types which should be visited, all others should be ignored
 */
async function walkCursor(cursor, options) {
  await cursor.iterate(node => {
    if (options.filterSet?.has(node.name)) {
      options.enterVisitor(node);
    }
  });
}

module.exports = {
  getFunctionName,
  getFunctionParameterNames,
  getFunctionClass,
  getEnclosingFunction,
  getTreeNodeAtLocation,
  getMetaBindings,
  nodeTypes,
  nodeTypeSets,
  walkTree,
  getTree,
  clear,
  walkCursor,
  positionToLocation,
};
