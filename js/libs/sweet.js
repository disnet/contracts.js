!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.sweet=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
/*
  Copyright (C) 2012 Tim Disney <tim@disnet.me>


  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
'use strict';
var _ = _dereq_('underscore');
var parser = _dereq_('./parser');
var syn = _dereq_('./syntax');
var se = _dereq_('./scopedEval');
var patternModule = _dereq_('./patterns');
var codegen = _dereq_('escodegen');
var assert = syn.assert;
var throwSyntaxError = syn.throwSyntaxError;
var throwSyntaxCaseError = syn.throwSyntaxCaseError;
var SyntaxCaseError = syn.SyntaxCaseError;
var unwrapSyntax = syn.unwrapSyntax;
// used to export "private" methods for unit testing
exports._test = {};
function StringMap(o) {
    this.__data = o || {};
}
StringMap.prototype = {
    has: function (key) {
        return Object.prototype.hasOwnProperty.call(this.__data, key);
    },
    get: function (key) {
        return this.has(key) ? this.__data[key] : void 0;
    },
    set: function (key, value) {
        this.__data[key] = value;
    },
    extend: function () {
        var args = _.map(_.toArray(arguments), function (x) {
                return x.__data;
            });
        _.extend.apply(_, [this.__data].concat(args));
        return this;
    }
};
var scopedEval = se.scopedEval;
var Rename = syn.Rename;
var Mark = syn.Mark;
var Def = syn.Def;
var syntaxFromToken = syn.syntaxFromToken;
var joinSyntax = syn.joinSyntax;
var builtinMode = false;
var expandCount = 0;
var maxExpands;
var push = Array.prototype.push;
function remdup(mark, mlist) {
    if (mark === _.first(mlist)) {
        return _.rest(mlist, 1);
    }
    return [mark].concat(mlist);
}
// (CSyntax) -> [...Num]
function marksof(ctx, stopName, originalName) {
    while (ctx) {
        if (ctx.constructor === Mark) {
            return remdup(ctx.mark, marksof(ctx.context, stopName, originalName));
        }
        if (ctx.constructor === Def) {
            ctx = ctx.context;
            continue;
        }
        if (ctx.constructor === Rename) {
            if (stopName === originalName + '$' + ctx.name) {
                return [];
            }
            ctx = ctx.context;
            continue;
        }
    }
    return [];
}
function resolve(stx) {
    return resolveCtx(stx.token.value, stx.context, [], [], {});
}
// This call memoizes intermediate results in the recursive invocation.
// The scope of the memo cache is the resolve() call, so that multiple
// resolve() calls don't walk all over each other, and memory used for
// the memoization can be garbage collected.
//
// The memoization addresses issue #232.
//
// It looks like the memoization uses only the context and doesn't look
// at originalName, stop_spine and stop_branch arguments. This is valid
// because whenever in every recursive call operates on a "deeper" or
// else a newly created context.  Therefore the collection of
// [originalName, stop_spine, stop_branch] can all be associated with a
// unique context. This argument is easier to see in a recursive
// rewrite of the resolveCtx function than with the while loop
// optimization - https://gist.github.com/srikumarks/9847260 - where the
// recursive steps always operate on a different context.
//
// This might make it seem that the resolution results can be stored on
// the context object itself, but that would not work in general
// because multiple resolve() calls will walk over each other's cache
// results, which fails tests. So the memoization uses only a context's
// unique instance numbers as the memoization key and is local to each
// resolve() call.
//
// With this memoization, the time complexity of the resolveCtx call is
// no longer exponential for the cases in issue #232.
function resolveCtx(originalName, ctx, stop_spine, stop_branch, cache) {
    if (!ctx) {
        return originalName;
    }
    var key = ctx.instNum;
    return cache[key] || (cache[key] = resolveCtxFull(originalName, ctx, stop_spine, stop_branch, cache));
}
// (Syntax) -> String
function resolveCtxFull(originalName, ctx, stop_spine, stop_branch, cache) {
    while (true) {
        if (!ctx) {
            return originalName;
        }
        if (ctx.constructor === Mark) {
            ctx = ctx.context;
            continue;
        }
        if (ctx.constructor === Def) {
            if (stop_spine.indexOf(ctx.defctx) !== -1) {
                ctx = ctx.context;
                continue;
            } else {
                stop_branch = unionEl(stop_branch, ctx.defctx);
                ctx = renames(ctx.defctx, ctx.context, originalName);
                continue;
            }
        }
        if (ctx.constructor === Rename) {
            if (originalName === ctx.id.token.value) {
                var idName = resolveCtx(ctx.id.token.value, ctx.id.context, stop_branch, stop_branch, cache);
                var subName = resolveCtx(originalName, ctx.context, unionEl(stop_spine, ctx.def), stop_branch, cache);
                if (idName === subName) {
                    var idMarks = marksof(ctx.id.context, originalName + '$' + ctx.name, originalName);
                    var subMarks = marksof(ctx.context, originalName + '$' + ctx.name, originalName);
                    if (arraysEqual(idMarks, subMarks)) {
                        return originalName + '$' + ctx.name;
                    }
                }
            }
            ctx = ctx.context;
            continue;
        }
        return originalName;
    }
}
function arraysEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
function renames(defctx, oldctx, originalName) {
    var acc = oldctx;
    for (var i = 0; i < defctx.length; i++) {
        if (defctx[i].id.token.value === originalName) {
            acc = new Rename(defctx[i].id, defctx[i].name, acc, defctx);
        }
    }
    return acc;
}
function unionEl(arr, el) {
    if (arr.indexOf(el) === -1) {
        var res = arr.slice(0);
        res.push(el);
        return res;
    }
    return arr;
}
var nextFresh = 0;
// fun () -> Num
function fresh() {
    return nextFresh++;
}
// wraps the array of syntax objects in the delimiters given by the second argument
// ([...CSyntax], CSyntax) -> [...CSyntax]
function wrapDelim(towrap, delimSyntax) {
    assert(delimSyntax.token.type === parser.Token.Delimiter, 'expecting a delimiter token');
    return syntaxFromToken({
        type: parser.Token.Delimiter,
        value: delimSyntax.token.value,
        inner: towrap,
        range: delimSyntax.token.range,
        startLineNumber: delimSyntax.token.startLineNumber,
        lineStart: delimSyntax.token.lineStart
    }, delimSyntax);
}
// (CSyntax) -> [...CSyntax]
function getParamIdentifiers(argSyntax) {
    if (argSyntax.token.type === parser.Token.Delimiter) {
        return _.filter(argSyntax.token.inner, function (stx) {
            return stx.token.value !== ',';
        });
    } else if (argSyntax.token.type === parser.Token.Identifier) {
        return [argSyntax];
    } else {
        assert(false, 'expecting a delimiter or a single identifier for function parameters');
    }
}
function inherit(parent, child, methods) {
    var P = function () {
    };
    P.prototype = parent.prototype;
    child.prototype = new P();
    child.prototype.constructor = child;
    _.extend(child.prototype, methods);
}
// A TermTree is the core data structure for the macro expansion process.
// It acts as a semi-structured representation of the syntax.
function TermTree() {
}
TermTree.properties = [];
TermTree.create = function () {
    return new TermTree();
};
TermTree.prototype = {
    'isTermTree': true,
    'destruct': function () {
        var self = this;
        return _.reduce(this.constructor.properties, function (acc, prop) {
            if (self[prop] && self[prop].isTermTree) {
                push.apply(acc, self[prop].destruct());
                return acc;
            } else if (self[prop] && self[prop].token && self[prop].token.inner) {
                var src = self[prop].token;
                var keys = Object.keys(src);
                var newtok = {};
                for (var i = 0, len = keys.length, key; i < len; i++) {
                    key = keys[i];
                    newtok[key] = src[key];
                }
                var clone = syntaxFromToken(newtok, self[prop]);
                clone.token.inner = _.reduce(clone.token.inner, function (acc$2, t) {
                    if (t && t.isTermTree) {
                        push.apply(acc$2, t.destruct());
                        return acc$2;
                    }
                    acc$2.push(t);
                    return acc$2;
                }, []);
                acc.push(clone);
                return acc;
            } else if (Array.isArray(self[prop])) {
                var destArr = _.reduce(self[prop], function (acc$2, t) {
                        if (t && t.isTermTree) {
                            push.apply(acc$2, t.destruct());
                            return acc$2;
                        }
                        acc$2.push(t);
                        return acc$2;
                    }, []);
                push.apply(acc, destArr);
                return acc;
            } else if (self[prop]) {
                acc.push(self[prop]);
                return acc;
            } else {
                return acc;
            }
        }, []);
    },
    'addDefCtx': function (def) {
        var self = this;
        _.each(this.constructor.properties, function (prop) {
            if (Array.isArray(self[prop])) {
                self[prop] = _.map(self[prop], function (item) {
                    return item.addDefCtx(def);
                });
            } else if (self[prop]) {
                self[prop] = self[prop].addDefCtx(def);
            }
        });
        return this;
    },
    'rename': function (id, name) {
        var self = this;
        _.each(this.constructor.properties, function (prop) {
            if (Array.isArray(self[prop])) {
                self[prop] = _.map(self[prop], function (item) {
                    return item.rename(id, name);
                });
            } else if (self[prop]) {
                self[prop] = self[prop].rename(id, name);
            }
        });
        return this;
    }
};
function EOF(eof) {
    this.eof = eof;
}
EOF.properties = ['eof'];
EOF.create = function (eof) {
    return new EOF(eof);
};
inherit(TermTree, EOF, { 'isEOF': true });
function Keyword(keyword) {
    this.keyword = keyword;
}
Keyword.properties = ['keyword'];
Keyword.create = function (keyword) {
    return new Keyword(keyword);
};
inherit(TermTree, Keyword, { 'isKeyword': true });
function Punc(punc) {
    this.punc = punc;
}
Punc.properties = ['punc'];
Punc.create = function (punc) {
    return new Punc(punc);
};
inherit(TermTree, Punc, { 'isPunc': true });
function Delimiter(delim) {
    this.delim = delim;
}
Delimiter.properties = ['delim'];
Delimiter.create = function (delim) {
    return new Delimiter(delim);
};
inherit(TermTree, Delimiter, { 'isDelimiter': true });
function LetMacro(name, body) {
    this.name = name;
    this.body = body;
}
LetMacro.properties = [
    'name',
    'body'
];
LetMacro.create = function (name, body) {
    return new LetMacro(name, body);
};
inherit(TermTree, LetMacro, { 'isLetMacro': true });
function Macro(name, body) {
    this.name = name;
    this.body = body;
}
Macro.properties = [
    'name',
    'body'
];
Macro.create = function (name, body) {
    return new Macro(name, body);
};
inherit(TermTree, Macro, { 'isMacro': true });
function AnonMacro(body) {
    this.body = body;
}
AnonMacro.properties = ['body'];
AnonMacro.create = function (body) {
    return new AnonMacro(body);
};
inherit(TermTree, AnonMacro, { 'isAnonMacro': true });
function OperatorDefinition(type, name, prec, assoc, body) {
    this.type = type;
    this.name = name;
    this.prec = prec;
    this.assoc = assoc;
    this.body = body;
}
OperatorDefinition.properties = [
    'type',
    'name',
    'prec',
    'assoc',
    'body'
];
OperatorDefinition.create = function (type, name, prec, assoc, body) {
    return new OperatorDefinition(type, name, prec, assoc, body);
};
inherit(TermTree, OperatorDefinition, { 'isOperatorDefinition': true });
function Module(body, exports$2) {
    this.body = body;
    this.exports = exports$2;
}
Module.properties = [
    'body',
    'exports'
];
Module.create = function (body, exports$2) {
    return new Module(body, exports$2);
};
inherit(TermTree, Module, { 'isModule': true });
function Export(name) {
    this.name = name;
}
Export.properties = ['name'];
Export.create = function (name) {
    return new Export(name);
};
inherit(TermTree, Export, { 'isExport': true });
function VariableDeclaration(ident, eq, init, comma) {
    this.ident = ident;
    this.eq = eq;
    this.init = init;
    this.comma = comma;
}
VariableDeclaration.properties = [
    'ident',
    'eq',
    'init',
    'comma'
];
VariableDeclaration.create = function (ident, eq, init, comma) {
    return new VariableDeclaration(ident, eq, init, comma);
};
inherit(TermTree, VariableDeclaration, { 'isVariableDeclaration': true });
function Statement() {
}
Statement.properties = [];
Statement.create = function () {
    return new Statement();
};
inherit(TermTree, Statement, { 'isStatement': true });
function Empty() {
}
Empty.properties = [];
Empty.create = function () {
    return new Empty();
};
inherit(Statement, Empty, { 'isEmpty': true });
function CatchClause(keyword, params, body) {
    this.keyword = keyword;
    this.params = params;
    this.body = body;
}
CatchClause.properties = [
    'keyword',
    'params',
    'body'
];
CatchClause.create = function (keyword, params, body) {
    return new CatchClause(keyword, params, body);
};
inherit(Statement, CatchClause, { 'isCatchClause': true });
function ForStatement(keyword, cond) {
    this.keyword = keyword;
    this.cond = cond;
}
ForStatement.properties = [
    'keyword',
    'cond'
];
ForStatement.create = function (keyword, cond) {
    return new ForStatement(keyword, cond);
};
inherit(Statement, ForStatement, { 'isForStatement': true });
function ReturnStatement(keyword, expr) {
    this.keyword = keyword;
    this.expr = expr;
}
ReturnStatement.properties = [
    'keyword',
    'expr'
];
ReturnStatement.create = function (keyword, expr) {
    return new ReturnStatement(keyword, expr);
};
inherit(Statement, ReturnStatement, {
    'isReturnStatement': true,
    'destruct': function () {
        var expr = this.expr.destruct();
        // need to adjust the line numbers to make sure that the expr
        // starts on the same line as the return keyword. This might
        // not be the case if an operator or infix macro perturbed the
        // line numbers during expansion.
        expr = adjustLineContext(expr, this.keyword.keyword);
        return this.keyword.destruct().concat(expr);
    }
});
function Expr() {
}
Expr.properties = [];
Expr.create = function () {
    return new Expr();
};
inherit(Statement, Expr, { 'isExpr': true });
function UnaryOp(op, expr) {
    this.op = op;
    this.expr = expr;
}
UnaryOp.properties = [
    'op',
    'expr'
];
UnaryOp.create = function (op, expr) {
    return new UnaryOp(op, expr);
};
inherit(Expr, UnaryOp, { 'isUnaryOp': true });
function PostfixOp(expr, op) {
    this.expr = expr;
    this.op = op;
}
PostfixOp.properties = [
    'expr',
    'op'
];
PostfixOp.create = function (expr, op) {
    return new PostfixOp(expr, op);
};
inherit(Expr, PostfixOp, { 'isPostfixOp': true });
function BinOp(left, op, right) {
    this.left = left;
    this.op = op;
    this.right = right;
}
BinOp.properties = [
    'left',
    'op',
    'right'
];
BinOp.create = function (left, op, right) {
    return new BinOp(left, op, right);
};
inherit(Expr, BinOp, { 'isBinOp': true });
function AssignmentExpression(left, op, right) {
    this.left = left;
    this.op = op;
    this.right = right;
}
AssignmentExpression.properties = [
    'left',
    'op',
    'right'
];
AssignmentExpression.create = function (left, op, right) {
    return new AssignmentExpression(left, op, right);
};
inherit(Expr, AssignmentExpression, { 'isAssignmentExpression': true });
function ConditionalExpression(cond, question, tru, colon, fls) {
    this.cond = cond;
    this.question = question;
    this.tru = tru;
    this.colon = colon;
    this.fls = fls;
}
ConditionalExpression.properties = [
    'cond',
    'question',
    'tru',
    'colon',
    'fls'
];
ConditionalExpression.create = function (cond, question, tru, colon, fls) {
    return new ConditionalExpression(cond, question, tru, colon, fls);
};
inherit(Expr, ConditionalExpression, { 'isConditionalExpression': true });
function NamedFun(keyword, star, name, params, body) {
    this.keyword = keyword;
    this.star = star;
    this.name = name;
    this.params = params;
    this.body = body;
}
NamedFun.properties = [
    'keyword',
    'star',
    'name',
    'params',
    'body'
];
NamedFun.create = function (keyword, star, name, params, body) {
    return new NamedFun(keyword, star, name, params, body);
};
inherit(Expr, NamedFun, { 'isNamedFun': true });
function AnonFun(keyword, star, params, body) {
    this.keyword = keyword;
    this.star = star;
    this.params = params;
    this.body = body;
}
AnonFun.properties = [
    'keyword',
    'star',
    'params',
    'body'
];
AnonFun.create = function (keyword, star, params, body) {
    return new AnonFun(keyword, star, params, body);
};
inherit(Expr, AnonFun, { 'isAnonFun': true });
function ArrowFun(params, arrow, body) {
    this.params = params;
    this.arrow = arrow;
    this.body = body;
}
ArrowFun.properties = [
    'params',
    'arrow',
    'body'
];
ArrowFun.create = function (params, arrow, body) {
    return new ArrowFun(params, arrow, body);
};
inherit(Expr, ArrowFun, { 'isArrowFun': true });
function ObjDotGet(left, dot, right) {
    this.left = left;
    this.dot = dot;
    this.right = right;
}
ObjDotGet.properties = [
    'left',
    'dot',
    'right'
];
ObjDotGet.create = function (left, dot, right) {
    return new ObjDotGet(left, dot, right);
};
inherit(Expr, ObjDotGet, { 'isObjDotGet': true });
function ObjGet(left, right) {
    this.left = left;
    this.right = right;
}
ObjGet.properties = [
    'left',
    'right'
];
ObjGet.create = function (left, right) {
    return new ObjGet(left, right);
};
inherit(Expr, ObjGet, { 'isObjGet': true });
function Template(template) {
    this.template = template;
}
Template.properties = ['template'];
Template.create = function (template) {
    return new Template(template);
};
inherit(Expr, Template, { 'isTemplate': true });
function Call(fun, args) {
    this.fun = fun;
    this.args = args;
}
Call.properties = [
    'fun',
    'args'
];
Call.create = function (fun, args) {
    return new Call(fun, args);
};
inherit(Expr, Call, { 'isCall': true });
function PrimaryExpression() {
}
PrimaryExpression.properties = [];
PrimaryExpression.create = function () {
    return new PrimaryExpression();
};
inherit(Expr, PrimaryExpression, { 'isPrimaryExpression': true });
function ThisExpression(keyword) {
    this.keyword = keyword;
}
ThisExpression.properties = ['keyword'];
ThisExpression.create = function (keyword) {
    return new ThisExpression(keyword);
};
inherit(PrimaryExpression, ThisExpression, { 'isThisExpression': true });
function Lit(lit) {
    this.lit = lit;
}
Lit.properties = ['lit'];
Lit.create = function (lit) {
    return new Lit(lit);
};
inherit(PrimaryExpression, Lit, { 'isLit': true });
function Block(body) {
    this.body = body;
}
Block.properties = ['body'];
Block.create = function (body) {
    return new Block(body);
};
inherit(PrimaryExpression, Block, { 'isBlock': true });
function ArrayLiteral(array) {
    this.array = array;
}
ArrayLiteral.properties = ['array'];
ArrayLiteral.create = function (array) {
    return new ArrayLiteral(array);
};
inherit(PrimaryExpression, ArrayLiteral, { 'isArrayLiteral': true });
function Id(id) {
    this.id = id;
}
Id.properties = ['id'];
Id.create = function (id) {
    return new Id(id);
};
inherit(PrimaryExpression, Id, { 'isId': true });
function Partial() {
}
Partial.properties = [];
Partial.create = function () {
    return new Partial();
};
inherit(TermTree, Partial, { 'isPartial': true });
function PartialOperation(stx, left) {
    this.stx = stx;
    this.left = left;
}
PartialOperation.properties = [
    'stx',
    'left'
];
PartialOperation.create = function (stx, left) {
    return new PartialOperation(stx, left);
};
inherit(Partial, PartialOperation, { 'isPartialOperation': true });
function PartialExpression(stx, left, combine) {
    this.stx = stx;
    this.left = left;
    this.combine = combine;
}
PartialExpression.properties = [
    'stx',
    'left',
    'combine'
];
PartialExpression.create = function (stx, left, combine) {
    return new PartialExpression(stx, left, combine);
};
inherit(Partial, PartialExpression, { 'isPartialExpression': true });
function BindingStatement(keyword, decls) {
    this.keyword = keyword;
    this.decls = decls;
}
BindingStatement.properties = [
    'keyword',
    'decls'
];
BindingStatement.create = function (keyword, decls) {
    return new BindingStatement(keyword, decls);
};
inherit(Statement, BindingStatement, {
    'isBindingStatement': true,
    'destruct': function () {
        return this.keyword.destruct().concat(_.reduce(this.decls, function (acc, decl) {
            push.apply(acc, decl.destruct());
            return acc;
        }, []));
    }
});
function VariableStatement(keyword, decls) {
    this.keyword = keyword;
    this.decls = decls;
}
VariableStatement.properties = [
    'keyword',
    'decls'
];
VariableStatement.create = function (keyword, decls) {
    return new VariableStatement(keyword, decls);
};
inherit(BindingStatement, VariableStatement, { 'isVariableStatement': true });
function LetStatement(keyword, decls) {
    this.keyword = keyword;
    this.decls = decls;
}
LetStatement.properties = [
    'keyword',
    'decls'
];
LetStatement.create = function (keyword, decls) {
    return new LetStatement(keyword, decls);
};
inherit(BindingStatement, LetStatement, { 'isLetStatement': true });
function ConstStatement(keyword, decls) {
    this.keyword = keyword;
    this.decls = decls;
}
ConstStatement.properties = [
    'keyword',
    'decls'
];
ConstStatement.create = function (keyword, decls) {
    return new ConstStatement(keyword, decls);
};
inherit(BindingStatement, ConstStatement, { 'isConstStatement': true });
function ParenExpression(args, delim, commas) {
    this.args = args;
    this.delim = delim;
    this.commas = commas;
}
ParenExpression.properties = [
    'args',
    'delim',
    'commas'
];
ParenExpression.create = function (args, delim, commas) {
    return new ParenExpression(args, delim, commas);
};
inherit(PrimaryExpression, ParenExpression, {
    'isParenExpression': true,
    'destruct': function () {
        var commas = this.commas.slice();
        var src = this.delim.token;
        var keys = Object.keys(src);
        var newtok = {};
        for (var i = 0, len = keys.length, key; i < len; i++) {
            key = keys[i];
            newtok[key] = src[key];
        }
        var delim = syntaxFromToken(newtok, this.delim);
        delim.token.inner = _.reduce(this.args, function (acc, term) {
            assert(term && term.isTermTree, 'expecting term trees in destruct of ParenExpression');
            push.apply(acc, term.destruct());
            // add all commas except for the last one
            if (commas.length > 0) {
                acc.push(commas.shift());
            }
            return acc;
        }, []);
        return Delimiter.create(delim).destruct();
    }
});
function stxIsUnaryOp(stx) {
    var staticOperators = [
            '+',
            '-',
            '~',
            '!',
            'delete',
            'void',
            'typeof',
            'yield',
            'new',
            '++',
            '--'
        ];
    return _.contains(staticOperators, unwrapSyntax(stx));
}
function stxIsBinOp(stx) {
    var staticOperators = [
            '+',
            '-',
            '*',
            '/',
            '%',
            '||',
            '&&',
            '|',
            '&',
            '^',
            '==',
            '!=',
            '===',
            '!==',
            '<',
            '>',
            '<=',
            '>=',
            'in',
            'instanceof',
            '<<',
            '>>',
            '>>>'
        ];
    return _.contains(staticOperators, unwrapSyntax(stx));
}
function getUnaryOpPrec(op) {
    var operatorPrecedence = {
            'new': 16,
            '++': 15,
            '--': 15,
            '!': 14,
            '~': 14,
            '+': 14,
            '-': 14,
            'typeof': 14,
            'void': 14,
            'delete': 14,
            'yield': 2
        };
    return operatorPrecedence[op];
}
function getBinaryOpPrec(op) {
    var operatorPrecedence = {
            '*': 13,
            '/': 13,
            '%': 13,
            '+': 12,
            '-': 12,
            '>>': 11,
            '<<': 11,
            '>>>': 11,
            '<': 10,
            '<=': 10,
            '>': 10,
            '>=': 10,
            'in': 10,
            'instanceof': 10,
            '==': 9,
            '!=': 9,
            '===': 9,
            '!==': 9,
            '&': 8,
            '^': 7,
            '|': 6,
            '&&': 5,
            '||': 4
        };
    return operatorPrecedence[op];
}
function getBinaryOpAssoc(op) {
    var operatorAssoc = {
            '*': 'left',
            '/': 'left',
            '%': 'left',
            '+': 'left',
            '-': 'left',
            '>>': 'left',
            '<<': 'left',
            '>>>': 'left',
            '<': 'left',
            '<=': 'left',
            '>': 'left',
            '>=': 'left',
            'in': 'left',
            'instanceof': 'left',
            '==': 'left',
            '!=': 'left',
            '===': 'left',
            '!==': 'left',
            '&': 'left',
            '^': 'left',
            '|': 'left',
            '&&': 'left',
            '||': 'left'
        };
    return operatorAssoc[op];
}
function stxIsAssignOp(stx) {
    var staticOperators = [
            '=',
            '+=',
            '-=',
            '*=',
            '/=',
            '%=',
            '<<=',
            '>>=',
            '>>>=',
            '|=',
            '^=',
            '&='
        ];
    return _.contains(staticOperators, unwrapSyntax(stx));
}
function enforestVarStatement(stx, context, varStx) {
    var decls = [];
    var rest = stx;
    var rhs;
    if (!rest.length) {
        throwSyntaxError('enforest', 'Unexpected end of input', varStx);
    }
    if (expandCount >= maxExpands) {
        return null;
    }
    while (rest.length) {
        if (rest[0].token.type === parser.Token.Identifier) {
            if (rest[1] && rest[1].token.type === parser.Token.Punctuator && rest[1].token.value === '=') {
                rhs = get_expression(rest.slice(2), context);
                if (rhs.result == null) {
                    throwSyntaxError('enforest', 'Unexpected token', rhs.rest[0]);
                }
                if (rhs.rest[0] && rhs.rest[0].token.type === parser.Token.Punctuator && rhs.rest[0].token.value === ',') {
                    decls.push(VariableDeclaration.create(rest[0], rest[1], rhs.result, rhs.rest[0]));
                    rest = rhs.rest.slice(1);
                    continue;
                } else {
                    decls.push(VariableDeclaration.create(rest[0], rest[1], rhs.result, null));
                    rest = rhs.rest;
                    break;
                }
            } else if (rest[1] && rest[1].token.type === parser.Token.Punctuator && rest[1].token.value === ',') {
                decls.push(VariableDeclaration.create(rest[0], null, null, rest[1]));
                rest = rest.slice(2);
            } else {
                decls.push(VariableDeclaration.create(rest[0], null, null, null));
                rest = rest.slice(1);
                break;
            }
        } else {
            throwSyntaxError('enforest', 'Unexpected token', rest[0]);
        }
    }
    return {
        result: decls,
        rest: rest
    };
}
function enforestAssignment(stx, context, left, prevStx, prevTerms) {
    var op = stx[0];
    var rightStx = stx.slice(1);
    var opTerm = Punc.create(stx[0]);
    var opPrevStx = tagWithTerm(opTerm, [stx[0]]).concat(tagWithTerm(left, left.destruct().reverse()), prevStx);
    var opPrevTerms = [
            opTerm,
            left
        ].concat(prevTerms);
    var opRes = enforest(rightStx, context, opPrevStx, opPrevTerms);
    if (opRes.result) {
        // Lookbehind was matched, so it may not even be a binop anymore.
        if (opRes.prevTerms.length < opPrevTerms.length) {
            return opRes;
        }
        var right = opRes.result;
        // only a binop if the right is a real expression
        // so 2+2++ will only match 2+2
        if (right.isExpr) {
            var term = AssignmentExpression.create(left, op, right);
            return {
                result: term,
                rest: opRes.rest,
                prevStx: prevStx,
                prevTerms: prevTerms
            };
        }
    } else {
        return opRes;
    }
}
function enforestParenExpression(parens, context) {
    var argRes, enforestedArgs = [], commas = [];
    var innerTokens = parens.expose().token.inner;
    while (innerTokens.length > 0) {
        argRes = enforest(innerTokens, context);
        if (!argRes.result || !argRes.result.isExpr) {
            return null;
        }
        enforestedArgs.push(argRes.result);
        innerTokens = argRes.rest;
        if (innerTokens[0] && innerTokens[0].token.value === ',') {
            // record the comma for later
            commas.push(innerTokens[0]);
            // but dump it for the next loop turn
            innerTokens = innerTokens.slice(1);
        } else {
            // either there are no more tokens or
            // they aren't a comma, either way we
            // are done with the loop
            break;
        }
    }
    return innerTokens.length ? null : ParenExpression.create(enforestedArgs, parens, commas);
}
function adjustLineContext(stx, original, current) {
    current = current || {
        lastLineNumber: stx[0].token.lineNumber || stx[0].token.startLineNumber,
        lineNumber: original.token.lineNumber
    };
    return _.map(stx, function (stx$2) {
        if (stx$2.token.type === parser.Token.Delimiter) {
            // handle tokens with missing line info
            stx$2.token.startLineNumber = typeof stx$2.token.startLineNumber == 'undefined' ? original.token.lineNumber : stx$2.token.startLineNumber;
            stx$2.token.endLineNumber = typeof stx$2.token.endLineNumber == 'undefined' ? original.token.lineNumber : stx$2.token.endLineNumber;
            stx$2.token.startLineStart = typeof stx$2.token.startLineStart == 'undefined' ? original.token.lineStart : stx$2.token.startLineStart;
            stx$2.token.endLineStart = typeof stx$2.token.endLineStart == 'undefined' ? original.token.lineStart : stx$2.token.endLineStart;
            stx$2.token.startRange = typeof stx$2.token.startRange == 'undefined' ? original.token.range : stx$2.token.startRange;
            stx$2.token.endRange = typeof stx$2.token.endRange == 'undefined' ? original.token.range : stx$2.token.endRange;
            stx$2.token.sm_startLineNumber = typeof stx$2.token.sm_startLineNumber == 'undefined' ? stx$2.token.startLineNumber : stx$2.token.sm_startLineNumber;
            stx$2.token.sm_endLineNumber = typeof stx$2.token.sm_endLineNumber == 'undefined' ? stx$2.token.endLineNumber : stx$2.token.sm_endLineNumber;
            stx$2.token.sm_startLineStart = typeof stx$2.token.sm_startLineStart == 'undefined' ? stx$2.token.startLineStart : stx$2.token.sm_startLineStart;
            stx$2.token.sm_endLineStart = typeof stx$2.token.sm_endLineStart == 'undefined' ? stx$2.token.endLineStart : stx$2.token.sm_endLineStart;
            stx$2.token.sm_startRange = typeof stx$2.token.sm_startRange == 'undefined' ? stx$2.token.startRange : stx$2.token.sm_startRange;
            stx$2.token.sm_endRange = typeof stx$2.token.sm_endRange == 'undefined' ? stx$2.token.endRange : stx$2.token.sm_endRange;
            if (stx$2.token.startLineNumber !== current.lineNumber) {
                if (stx$2.token.startLineNumber !== current.lastLineNumber) {
                    current.lineNumber++;
                    current.lastLineNumber = stx$2.token.startLineNumber;
                    stx$2.token.startLineNumber = current.lineNumber;
                } else {
                    current.lastLineNumber = stx$2.token.startLineNumber;
                    stx$2.token.startLineNumber = current.lineNumber;
                }
            }
            if (stx$2.token.inner.length > 0) {
                stx$2.token.inner = adjustLineContext(stx$2.token.inner, original, current);
            }
            return stx$2;
        }
        // handle tokens with missing line info
        stx$2.token.lineNumber = typeof stx$2.token.lineNumber == 'undefined' ? original.token.lineNumber : stx$2.token.lineNumber;
        stx$2.token.lineStart = typeof stx$2.token.lineStart == 'undefined' ? original.token.lineStart : stx$2.token.lineStart;
        stx$2.token.range = typeof stx$2.token.range == 'undefined' ? original.token.range : stx$2.token.range;
        // Only set the sourcemap line info once. Necessary because a single
        // syntax object can go through expansion multiple times. If at some point
        // we want to write an expansion stepper this might be a good place to store
        // intermediate expansion line info (ie push to a stack instead of
        // just write once).
        stx$2.token.sm_lineNumber = typeof stx$2.token.sm_lineNumber == 'undefined' ? stx$2.token.lineNumber : stx$2.token.sm_lineNumber;
        stx$2.token.sm_lineStart = typeof stx$2.token.sm_lineStart == 'undefined' ? stx$2.token.lineStart : stx$2.token.sm_lineStart;
        stx$2.token.sm_range = typeof stx$2.token.sm_range == 'undefined' ? stx$2.token.range.slice() : stx$2.token.sm_range;
        // move the line info to line up with the macro name
        // (line info starting from the macro name)
        if (stx$2.token.lineNumber !== current.lineNumber) {
            if (stx$2.token.lineNumber !== current.lastLineNumber) {
                current.lineNumber++;
                current.lastLineNumber = stx$2.token.lineNumber;
                stx$2.token.lineNumber = current.lineNumber;
            } else {
                current.lastLineNumber = stx$2.token.lineNumber;
                stx$2.token.lineNumber = current.lineNumber;
            }
        }
        return stx$2;
    });
}
function getName(head, rest) {
    var idx = 0;
    var curr = head;
    var next = rest[idx];
    var name = [head];
    while (true) {
        if (next && (next.token.type === parser.Token.Punctuator || next.token.type === parser.Token.Identifier || next.token.type === parser.Token.Keyword) && (curr.token.sm_range && next.token.sm_range && curr.token.sm_range[1] === next.token.sm_range[0] || curr.token.range[1] === next.token.range[0])) {
            name.push(next);
            curr = next;
            next = rest[++idx];
        } else {
            return name;
        }
    }
}
function getMacroInEnv(head, rest, env) {
    if (!(head.token.type === parser.Token.Identifier || head.token.type === parser.Token.Keyword || head.token.type === parser.Token.Punctuator)) {
        return null;
    }
    var name = getName(head, rest);
    // simple case, don't need to create a new syntax object
    if (name.length === 1) {
        if (env.names.get(unwrapSyntax(name[0]))) {
            var resolvedName = resolve(name[0]);
            if (env.has(resolvedName)) {
                return env.get(resolvedName);
            }
        }
        return null;
    } else {
        while (name.length > 0) {
            var nameStr = name.map(unwrapSyntax).join('');
            if (env.names.get(nameStr)) {
                var nameStx = syn.makeIdent(nameStr, name[0]);
                var resolvedName = resolve(nameStx);
                if (env.has(resolvedName)) {
                    return env.get(resolvedName);
                }
            }
            name.pop();
        }
        return null;
    }
}
function nameInEnv(head, rest, env) {
    return getMacroInEnv(head, rest, env) !== null;
}
// This should only be used on things that can't be rebound except by
// macros (puncs, keywords).
function resolveFast(stx, env) {
    var name = unwrapSyntax(stx);
    return env.names.get(name) ? resolve(stx) : name;
}
function expandMacro(stx, context, opCtx, opType, macroObj) {
    // pull the macro transformer out the environment
    var head = stx[0];
    var rest = stx.slice(1);
    macroObj = macroObj || getMacroInEnv(head, rest, context.env);
    var stxArg = rest.slice(macroObj.fullName.length - 1);
    var transformer;
    if (opType != null) {
        assert(opType === 'binary' || opType === 'unary', 'operator type should be either unary or binary: ' + opType);
        transformer = macroObj[opType].fn;
    } else {
        transformer = macroObj.fn;
    }
    // create a new mark to be used for the input to
    // the macro
    var newMark = fresh();
    var transformerContext = makeExpanderContext(_.defaults({ mark: newMark }, context));
    // apply the transformer
    var rt;
    try {
        rt = transformer([head].concat(stxArg), transformerContext, opCtx.prevStx, opCtx.prevTerms);
    } catch (e) {
        if (e instanceof SyntaxCaseError) {
            // add a nicer error for syntax case
            var nameStr = macroObj.fullName.map(function (stx$2) {
                    return stx$2.token.value;
                }).join('');
            if (opType != null) {
                var argumentString = '`' + stxArg.slice(0, 5).map(function (stx$2) {
                        return stx$2.token.value;
                    }).join(' ') + '...`';
                throwSyntaxError('operator', 'Operator `' + nameStr + '` could not be matched with ' + argumentString, head);
            } else {
                var argumentString = '`' + stxArg.slice(0, 5).map(function (stx$2) {
                        return stx$2.token.value;
                    }).join(' ') + '...`';
                throwSyntaxError('macro', 'Macro `' + nameStr + '` could not be matched with ' + argumentString, head);
            }
        } else {
            // just rethrow it
            throw e;
        }
    }
    if (!builtinMode && !macroObj.builtin) {
        expandCount++;
    }
    if (!Array.isArray(rt.result)) {
        throwSyntaxError('enforest', 'Macro must return a syntax array', stx[0]);
    }
    if (rt.result.length > 0) {
        var adjustedResult = adjustLineContext(rt.result, head);
        if (stx[0].token.leadingComments) {
            if (adjustedResult[0].token.leadingComments) {
                adjustedResult[0].token.leadingComments = adjustedResult[0].token.leadingComments.concat(head.token.leadingComments);
            } else {
                adjustedResult[0].token.leadingComments = head.token.leadingComments;
            }
        }
        rt.result = adjustedResult;
    }
    return rt;
}
function comparePrec(left, right, assoc) {
    if (assoc === 'left') {
        return left <= right;
    }
    return left < right;
}
// enforest the tokens, returns an object with the `result` TermTree and
// the uninterpreted `rest` of the syntax
function enforest(toks, context, prevStx, prevTerms) {
    assert(toks.length > 0, 'enforest assumes there are tokens to work with');
    prevStx = prevStx || [];
    prevTerms = prevTerms || [];
    if (expandCount >= maxExpands) {
        return {
            result: null,
            rest: toks
        };
    }
    function step(head, rest, opCtx) {
        var innerTokens;
        assert(Array.isArray(rest), 'result must at least be an empty array');
        if (head.isTermTree) {
            var isCustomOp = false;
            var uopMacroObj;
            var uopSyntax;
            if (head.isPunc || head.isKeyword || head.isId) {
                if (head.isPunc) {
                    uopSyntax = head.punc;
                } else if (head.isKeyword) {
                    uopSyntax = head.keyword;
                } else if (head.isId) {
                    uopSyntax = head.id;
                }
                uopMacroObj = getMacroInEnv(uopSyntax, rest, context.env);
                isCustomOp = uopMacroObj && uopMacroObj.isOp;
            }
            // look up once (we want to check multiple properties on bopMacroObj
            // without repeatedly calling getMacroInEnv)
            var bopMacroObj;
            if (rest[0] && rest[1]) {
                bopMacroObj = getMacroInEnv(rest[0], rest.slice(1), context.env);
            }
            // unary operator
            if (isCustomOp && uopMacroObj.unary || uopSyntax && stxIsUnaryOp(uopSyntax)) {
                var uopPrec;
                if (isCustomOp && uopMacroObj.unary) {
                    uopPrec = uopMacroObj.unary.prec;
                } else {
                    uopPrec = getUnaryOpPrec(unwrapSyntax(uopSyntax));
                }
                var opRest = rest;
                var uopMacroName;
                if (uopMacroObj) {
                    uopMacroName = [uopSyntax].concat(rest.slice(0, uopMacroObj.fullName.length - 1));
                    opRest = rest.slice(uopMacroObj.fullName.length - 1);
                }
                var leftLeft = opCtx.prevTerms[0] && opCtx.prevTerms[0].isPartial ? opCtx.prevTerms[0] : null;
                var unopTerm = PartialOperation.create(head, leftLeft);
                var unopPrevStx = tagWithTerm(unopTerm, head.destruct().reverse()).concat(opCtx.prevStx);
                var unopPrevTerms = [unopTerm].concat(opCtx.prevTerms);
                var unopOpCtx = _.extend({}, opCtx, {
                        combine: function (t) {
                            if (t.isExpr) {
                                if (isCustomOp && uopMacroObj.unary) {
                                    var rt$2 = expandMacro(uopMacroName.concat(t.destruct()), context, opCtx, 'unary');
                                    var newt = get_expression(rt$2.result, context);
                                    assert(newt.rest.length === 0, 'should never have left over syntax');
                                    return opCtx.combine(newt.result);
                                }
                                return opCtx.combine(UnaryOp.create(uopSyntax, t));
                            } else {
                                // not actually an expression so don't create
                                // a UnaryOp term just return with the punctuator
                                return opCtx.combine(head);
                            }
                        },
                        prec: uopPrec,
                        prevStx: unopPrevStx,
                        prevTerms: unopPrevTerms,
                        op: unopTerm
                    });
                return step(opRest[0], opRest.slice(1), unopOpCtx);
            }    // BinOp
            else if (head.isExpr && (rest[0] && rest[1] && (stxIsBinOp(rest[0]) && !bopMacroObj || bopMacroObj && bopMacroObj.isOp && bopMacroObj.binary))) {
                var opRes;
                var op = rest[0];
                var left = head;
                var rightStx = rest.slice(1);
                var leftLeft = opCtx.prevTerms[0] && opCtx.prevTerms[0].isPartial ? opCtx.prevTerms[0] : null;
                var leftTerm = PartialExpression.create(head.destruct(), leftLeft, function () {
                        return step(head, [], opCtx);
                    });
                var opTerm = PartialOperation.create(op, leftTerm);
                var opPrevStx = tagWithTerm(opTerm, [rest[0]]).concat(tagWithTerm(leftTerm, head.destruct()).reverse(), opCtx.prevStx);
                var opPrevTerms = [
                        opTerm,
                        leftTerm
                    ].concat(opCtx.prevTerms);
                var isCustomOp = bopMacroObj && bopMacroObj.isOp && bopMacroObj.binary;
                var bopPrec;
                var bopAssoc;
                if (isCustomOp && bopMacroObj.binary) {
                    bopPrec = bopMacroObj.binary.prec;
                    bopAssoc = bopMacroObj.binary.assoc;
                } else {
                    bopPrec = getBinaryOpPrec(unwrapSyntax(op));
                    bopAssoc = getBinaryOpAssoc(unwrapSyntax(op));
                }
                assert(bopPrec !== undefined, 'expecting a precedence for operator: ' + op);
                var newStack;
                if (comparePrec(bopPrec, opCtx.prec, bopAssoc)) {
                    var bopCtx = opCtx;
                    var combResult = opCtx.combine(head);
                    if (opCtx.stack.length > 0) {
                        return step(combResult.term, rest, opCtx.stack[0]);
                    }
                    left = combResult.term;
                    newStack = opCtx.stack;
                    opPrevStx = combResult.prevStx;
                    opPrevTerms = combResult.prevTerms;
                } else {
                    newStack = [opCtx].concat(opCtx.stack);
                }
                assert(opCtx.combine !== undefined, 'expecting a combine function');
                var opRightStx = rightStx;
                var bopMacroName;
                if (isCustomOp) {
                    bopMacroName = rest.slice(0, bopMacroObj.fullName.length);
                    opRightStx = rightStx.slice(bopMacroObj.fullName.length - 1);
                }
                var bopOpCtx = _.extend({}, opCtx, {
                        combine: function (right) {
                            if (right.isExpr) {
                                if (isCustomOp && bopMacroObj.binary) {
                                    var leftStx = left.destruct();
                                    var rightStx$2 = right.destruct();
                                    var rt$2 = expandMacro(bopMacroName.concat(syn.makeDelim('()', leftStx, leftStx[0]), syn.makeDelim('()', rightStx$2, rightStx$2[0])), context, opCtx, 'binary');
                                    var newt = get_expression(rt$2.result, context);
                                    assert(newt.rest.length === 0, 'should never have left over syntax');
                                    return {
                                        term: newt.result,
                                        prevStx: opPrevStx,
                                        prevTerms: opPrevTerms
                                    };
                                }
                                return {
                                    term: BinOp.create(left, op, right),
                                    prevStx: opPrevStx,
                                    prevTerms: opPrevTerms
                                };
                            } else {
                                return {
                                    term: head,
                                    prevStx: opPrevStx,
                                    prevTerms: opPrevTerms
                                };
                            }
                        },
                        prec: bopPrec,
                        op: opTerm,
                        stack: newStack,
                        prevStx: opPrevStx,
                        prevTerms: opPrevTerms
                    });
                return step(opRightStx[0], opRightStx.slice(1), bopOpCtx);
            }    // Call
            else if (head.isExpr && (rest[0] && rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()')) {
                var parenRes = enforestParenExpression(rest[0], context);
                if (parenRes) {
                    return step(Call.create(head, parenRes), rest.slice(1), opCtx);
                }
            }    // Conditional ( x ? true : false)
            else if (head.isExpr && (rest[0] && resolveFast(rest[0], context.env) === '?')) {
                var question = rest[0];
                var condRes = enforest(rest.slice(1), context);
                if (condRes.result) {
                    var truExpr = condRes.result;
                    var condRight = condRes.rest;
                    if (truExpr.isExpr && condRight[0] && resolveFast(condRight[0], context.env) === ':') {
                        var colon = condRight[0];
                        var flsRes = enforest(condRight.slice(1), context);
                        var flsExpr = flsRes.result;
                        if (flsExpr.isExpr) {
                            return step(ConditionalExpression.create(head, question, truExpr, colon, flsExpr), flsRes.rest, opCtx);
                        }
                    }
                }
            }    // Arrow functions with expression bodies
            else if (head.isDelimiter && head.delim.token.value === '()' && rest[0] && rest[0].token.type === parser.Token.Punctuator && resolveFast(rest[0], context.env) === '=>') {
                var arrowRes = enforest(rest.slice(1), context);
                if (arrowRes.result && arrowRes.result.isExpr) {
                    return step(ArrowFun.create(head.delim, rest[0], arrowRes.result.destruct()), arrowRes.rest, opCtx);
                } else {
                    throwSyntaxError('enforest', 'Body of arrow function must be an expression', rest.slice(1));
                }
            }    // Arrow functions with expression bodies
            else if (head.isId && rest[0] && rest[0].token.type === parser.Token.Punctuator && resolveFast(rest[0], context.env) === '=>') {
                var res = enforest(rest.slice(1), context);
                if (res.result && res.result.isExpr) {
                    return step(ArrowFun.create(head.id, rest[0], res.result.destruct()), res.rest, opCtx);
                } else {
                    throwSyntaxError('enforest', 'Body of arrow function must be an expression', rest.slice(1));
                }
            }    // ParenExpr
            else if (head.isDelimiter && head.delim.token.value === '()') {
                // empty parens are acceptable but enforest
                // doesn't accept empty arrays so short
                // circuit here
                if (head.delim.token.inner.length === 0) {
                    return step(ParenExpression.create([Empty.create()], head.delim.expose(), []), rest, opCtx);
                } else {
                    var parenRes = enforestParenExpression(head.delim, context);
                    if (parenRes) {
                        return step(parenRes, rest, opCtx);
                    }
                }
            }    // AssignmentExpression
            else if (head.isExpr && ((head.isId || head.isObjGet || head.isObjDotGet || head.isThisExpression) && rest[0] && rest[1] && !bopMacroObj && stxIsAssignOp(rest[0]))) {
                var opRes = enforestAssignment(rest, context, head, prevStx, prevTerms);
                if (opRes && opRes.result) {
                    return step(opRes.result, opRes.rest, _.extend({}, opCtx, {
                        prevStx: opRes.prevStx,
                        prevTerms: opRes.prevTerms
                    }));
                }
            }    // Postfix
            else if (head.isExpr && (rest[0] && (unwrapSyntax(rest[0]) === '++' || unwrapSyntax(rest[0]) === '--'))) {
                // Check if the operator is a macro first.
                if (context.env.has(resolveFast(rest[0], context.env))) {
                    var headStx = tagWithTerm(head, head.destruct().reverse());
                    var opPrevStx = headStx.concat(prevStx);
                    var opPrevTerms = [head].concat(prevTerms);
                    var opRes = enforest(rest, context, opPrevStx, opPrevTerms);
                    if (opRes.prevTerms.length < opPrevTerms.length) {
                        return opRes;
                    } else if (opRes.result) {
                        return step(head, opRes.result.destruct().concat(opRes.rest), opCtx);
                    }
                }
                return step(PostfixOp.create(head, rest[0]), rest.slice(1), opCtx);
            }    // ObjectGet (computed)
            else if (head.isExpr && (rest[0] && rest[0].token.value === '[]')) {
                return step(ObjGet.create(head, Delimiter.create(rest[0].expose())), rest.slice(1), opCtx);
            }    // ObjectGet
            else if (head.isExpr && (rest[0] && unwrapSyntax(rest[0]) === '.' && !context.env.has(resolveFast(rest[0], context.env)) && rest[1] && (rest[1].token.type === parser.Token.Identifier || rest[1].token.type === parser.Token.Keyword))) {
                // Check if the identifier is a macro first.
                if (context.env.has(resolveFast(rest[1], context.env))) {
                    var headStx = tagWithTerm(head, head.destruct().reverse());
                    var dotTerm = Punc.create(rest[0]);
                    var dotTerms = [dotTerm].concat(head, prevTerms);
                    var dotStx = tagWithTerm(dotTerm, [rest[0]]).concat(headStx, prevStx);
                    var dotRes = enforest(rest.slice(1), context, dotStx, dotTerms);
                    if (dotRes.prevTerms.length < dotTerms.length) {
                        return dotRes;
                    } else if (dotRes.result) {
                        return step(head, [rest[0]].concat(dotRes.result.destruct(), dotRes.rest), opCtx);
                    }
                }
                return step(ObjDotGet.create(head, rest[0], rest[1]), rest.slice(2), opCtx);
            }    // ArrayLiteral
            else if (head.isDelimiter && head.delim.token.value === '[]') {
                return step(ArrayLiteral.create(head), rest, opCtx);
            }    // Block
            else if (head.isDelimiter && head.delim.token.value === '{}') {
                return step(Block.create(head), rest, opCtx);
            }    // quote syntax
            else if (head.isId && unwrapSyntax(head.id) === '#quoteSyntax' && rest[0] && rest[0].token.value === '{}') {
                var tempId = fresh();
                context.templateMap.set(tempId, rest[0].token.inner);
                return step(syn.makeIdent('getTemplate', head.id), [syn.makeDelim('()', [syn.makeValue(tempId, head.id)], head.id)].concat(rest.slice(1)), opCtx);
            }    // return statement
            else if (head.isKeyword && unwrapSyntax(head.keyword) === 'return') {
                if (rest[0]) {
                    var returnPrevStx = tagWithTerm(head, head.destruct()).concat(opCtx.prevStx);
                    var returnPrevTerms = [head].concat(opCtx.prevTerms);
                    var returnExpr = enforest(rest, context, returnPrevStx, returnPrevTerms);
                    if (returnExpr.prevTerms.length < opCtx.prevTerms.length) {
                        return returnExpr;
                    }
                    if (returnExpr.result.isExpr) {
                        return step(ReturnStatement.create(head, returnExpr.result), returnExpr.rest, opCtx);
                    }
                }
            }    // let statements
            else if (head.isKeyword && unwrapSyntax(head.keyword) === 'let') {
                var nameTokens = [];
                if (rest[0] && rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()') {
                    nameTokens = rest[0].token.inner;
                } else {
                    nameTokens.push(rest[0]);
                }
                // Let macro
                if (rest[1] && rest[1].token.value === '=' && rest[2] && rest[2].token.value === 'macro') {
                    var mac = enforest(rest.slice(2), context);
                    if (mac.result) {
                        if (!mac.result.isAnonMacro) {
                            throwSyntaxError('enforest', 'expecting an anonymous macro definition in syntax let binding', rest.slice(2));
                        }
                        return step(LetMacro.create(nameTokens, mac.result.body), mac.rest, opCtx);
                    }
                }    // Let statement
                else {
                    var lsRes = enforestVarStatement(rest, context, head.keyword);
                    if (lsRes && lsRes.result) {
                        return step(LetStatement.create(head, lsRes.result), lsRes.rest, opCtx);
                    }
                }
            }    // VariableStatement
            else if (head.isKeyword && unwrapSyntax(head.keyword) === 'var' && rest[0]) {
                var vsRes = enforestVarStatement(rest, context, head.keyword);
                if (vsRes && vsRes.result) {
                    return step(VariableStatement.create(head, vsRes.result), vsRes.rest, opCtx);
                }
            }    // Const Statement
            else if (head.isKeyword && unwrapSyntax(head.keyword) === 'const' && rest[0]) {
                var csRes = enforestVarStatement(rest, context, head.keyword);
                if (csRes && csRes.result) {
                    return step(ConstStatement.create(head, csRes.result), csRes.rest, opCtx);
                }
            }    // for statement
            else if (head.isKeyword && unwrapSyntax(head.keyword) === 'for' && rest[0] && rest[0].token.value === '()') {
                return step(ForStatement.create(head.keyword, rest[0]), rest.slice(1), opCtx);
            }
        } else {
            assert(head && head.token, 'assuming head is a syntax object');
            var macroObj = expandCount < maxExpands && getMacroInEnv(head, rest, context.env);
            // macro invocation
            if (macroObj && !macroObj.isOp) {
                var rt = expandMacro([head].concat(rest), context, opCtx, null, macroObj);
                var newOpCtx = opCtx;
                if (rt.prevTerms && rt.prevTerms.length < opCtx.prevTerms.length) {
                    newOpCtx = rewindOpCtx(opCtx, rt);
                }
                if (rt.result.length > 0) {
                    return step(rt.result[0], rt.result.slice(1).concat(rt.rest), newOpCtx);
                } else {
                    return step(Empty.create(), rt.rest, newOpCtx);
                }
            }    // anon macro definition
            else if (head.token.type === parser.Token.Identifier && resolve(head) === 'macro' && rest[0] && rest[0].token.value === '{}') {
                return step(AnonMacro.create(rest[0].expose().token.inner), rest.slice(1), opCtx);
            }    // macro definition
            else if (head.token.type === parser.Token.Identifier && resolve(head) === 'macro') {
                var nameTokens = [];
                if (rest[0] && rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()') {
                    nameTokens = rest[0].expose().token.inner;
                } else {
                    nameTokens.push(rest[0]);
                }
                if (rest[1] && rest[1].token.type === parser.Token.Delimiter) {
                    return step(Macro.create(nameTokens, rest[1].expose().token.inner), rest.slice(2), opCtx);
                } else {
                    throwSyntaxError('enforest', 'Macro declaration must include body', rest[1]);
                }
            }    // operator definition
                 // unaryop (neg) 1 { macro { rule { $op:expr } => { $op } } }
            else if (head.token.type === parser.Token.Identifier && head.token.value === 'unaryop' && rest[0] && rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()' && rest[1] && rest[1].token.type === parser.Token.NumericLiteral && rest[2] && rest[2].token.type === parser.Token.Delimiter && rest[2] && rest[2].token.value === '{}') {
                var trans = enforest(rest[2].expose().token.inner, context);
                return step(OperatorDefinition.create('unary', rest[0].expose().token.inner, rest[1], null, trans.result.body), rest.slice(3), opCtx);
            }    // operator definition
                 // binaryop (neg) 1 left { macro { rule { $op:expr } => { $op } } }
            else if (head.token.type === parser.Token.Identifier && head.token.value === 'binaryop' && rest[0] && rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()' && rest[1] && rest[1].token.type === parser.Token.NumericLiteral && rest[2] && rest[2].token.type === parser.Token.Identifier && rest[3] && rest[3].token.type === parser.Token.Delimiter && rest[3] && rest[3].token.value === '{}') {
                var trans = enforest(rest[3].expose().token.inner, context);
                return step(OperatorDefinition.create('binary', rest[0].expose().token.inner, rest[1], rest[2], trans.result.body), rest.slice(4), opCtx);
            }    // module definition
            else if (unwrapSyntax(head) === 'module' && rest[0] && rest[0].token.value === '{}') {
                return step(Module.create(rest[0], []), rest.slice(1), opCtx);
            }    // function definition
            else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'function' && rest[0] && rest[0].token.type === parser.Token.Identifier && rest[1] && rest[1].token.type === parser.Token.Delimiter && rest[1].token.value === '()' && rest[2] && rest[2].token.type === parser.Token.Delimiter && rest[2].token.value === '{}') {
                rest[1].token.inner = rest[1].expose().token.inner;
                rest[2].token.inner = rest[2].expose().token.inner;
                return step(NamedFun.create(head, null, rest[0], rest[1], rest[2]), rest.slice(3), opCtx);
            }    // generator function definition
            else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'function' && rest[0] && rest[0].token.type === parser.Token.Punctuator && rest[0].token.value === '*' && rest[1] && rest[1].token.type === parser.Token.Identifier && rest[2] && rest[2].token.type === parser.Token.Delimiter && rest[2].token.value === '()' && rest[3] && rest[3].token.type === parser.Token.Delimiter && rest[3].token.value === '{}') {
                rest[2].token.inner = rest[2].expose().token.inner;
                rest[3].token.inner = rest[3].expose().token.inner;
                return step(NamedFun.create(head, rest[0], rest[1], rest[2], rest[3]), rest.slice(4), opCtx);
            }    // anonymous function definition
            else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'function' && rest[0] && rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()' && rest[1] && rest[1].token.type === parser.Token.Delimiter && rest[1].token.value === '{}') {
                rest[0].token.inner = rest[0].expose().token.inner;
                rest[1].token.inner = rest[1].expose().token.inner;
                return step(AnonFun.create(head, null, rest[0], rest[1]), rest.slice(2), opCtx);
            }    // anonymous generator function definition
            else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'function' && rest[0] && rest[0].token.type === parser.Token.Punctuator && rest[0].token.value === '*' && rest[1] && rest[1].token.type === parser.Token.Delimiter && rest[1].token.value === '()' && rest[2] && rest[2].token.type === parser.Token.Delimiter && rest[2].token.value === '{}') {
                rest[1].token.inner = rest[1].expose().token.inner;
                rest[2].token.inner = rest[2].expose().token.inner;
                return step(AnonFun.create(head, rest[0], rest[1], rest[2]), rest.slice(3), opCtx);
            }    // arrow function
            else if ((head.token.type === parser.Token.Delimiter && head.token.value === '()' || head.token.type === parser.Token.Identifier) && rest[0] && rest[0].token.type === parser.Token.Punctuator && resolveFast(rest[0], context.env) === '=>' && rest[1] && rest[1].token.type === parser.Token.Delimiter && rest[1].token.value === '{}') {
                return step(ArrowFun.create(head, rest[0], rest[1]), rest.slice(2), opCtx);
            }    // catch statement
            else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'catch' && rest[0] && rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()' && rest[1] && rest[1].token.type === parser.Token.Delimiter && rest[1].token.value === '{}') {
                rest[0].token.inner = rest[0].expose().token.inner;
                rest[1].token.inner = rest[1].expose().token.inner;
                return step(CatchClause.create(head, rest[0], rest[1]), rest.slice(2), opCtx);
            }    // this expression
            else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'this') {
                return step(ThisExpression.create(head), rest, opCtx);
            }    // literal
            else if (head.token.type === parser.Token.NumericLiteral || head.token.type === parser.Token.StringLiteral || head.token.type === parser.Token.BooleanLiteral || head.token.type === parser.Token.RegularExpression || head.token.type === parser.Token.NullLiteral) {
                return step(Lit.create(head), rest, opCtx);
            }    // export
            else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'export' && rest[0] && (rest[0].token.type === parser.Token.Identifier || rest[0].token.type === parser.Token.Keyword || rest[0].token.type === parser.Token.Punctuator || rest[0].token.type === parser.Token.Delimiter && rest[0].token.value === '()')) {
                // Consume optional semicolon                      
                if (unwrapSyntax(rest[1]) === ';') {
                    rest.splice(1, 1);
                }
                return step(Export.create(rest[0]), rest.slice(1), opCtx);
            }    // identifier
            else if (head.token.type === parser.Token.Identifier) {
                return step(Id.create(head), rest, opCtx);
            }    // punctuator
            else if (head.token.type === parser.Token.Punctuator) {
                return step(Punc.create(head), rest, opCtx);
            } else if (head.token.type === parser.Token.Keyword && unwrapSyntax(head) === 'with') {
                throwSyntaxError('enforest', 'with is not supported in sweet.js', head);
            }    // keyword
            else if (head.token.type === parser.Token.Keyword) {
                return step(Keyword.create(head), rest, opCtx);
            }    // Delimiter
            else if (head.token.type === parser.Token.Delimiter) {
                return step(Delimiter.create(head.expose()), rest, opCtx);
            } else if (head.token.type === parser.Token.Template) {
                return step(Template.create(head), rest, opCtx);
            }    // end of file
            else if (head.token.type === parser.Token.EOF) {
                assert(rest.length === 0, 'nothing should be after an EOF');
                return step(EOF.create(head), [], opCtx);
            } else {
                // todo: are we missing cases?
                assert(false, 'not implemented');
            }
        }
        // Potentially an infix macro
        // This should only be invoked on runtime syntax terms
        if (!head.isMacro && !head.isLetMacro && !head.isAnonMacro && !head.isOperatorDefinition && rest.length && nameInEnv(rest[0], rest.slice(1), context.env)) {
            var infLeftTerm = opCtx.prevTerms[0] && opCtx.prevTerms[0].isPartial ? opCtx.prevTerms[0] : null;
            var infTerm = PartialExpression.create(head.destruct(), infLeftTerm, function () {
                    return step(head, [], opCtx);
                });
            var infPrevStx = tagWithTerm(infTerm, head.destruct()).reverse().concat(opCtx.prevStx);
            var infPrevTerms = [infTerm].concat(opCtx.prevTerms);
            var infRes = expandMacro(rest, context, {
                    prevStx: infPrevStx,
                    prevTerms: infPrevTerms
                });
            if (infRes.prevTerms && infRes.prevTerms.length < infPrevTerms.length) {
                var infOpCtx = rewindOpCtx(opCtx, infRes);
                return step(infRes.result[0], infRes.result.slice(1).concat(infRes.rest), infOpCtx);
            } else {
                return step(head, infRes.result.concat(infRes.rest), opCtx);
            }
        }
        // done with current step so combine and continue on
        var combResult = opCtx.combine(head);
        if (opCtx.stack.length === 0) {
            return {
                result: combResult.term,
                rest: rest,
                prevStx: combResult.prevStx,
                prevTerms: combResult.prevTerms
            };
        } else {
            return step(combResult.term, rest, opCtx.stack[0]);
        }
    }
    return step(toks[0], toks.slice(1), {
        combine: function (t) {
            return {
                term: t,
                prevStx: prevStx,
                prevTerms: prevTerms
            };
        },
        prec: 0,
        stack: [],
        op: null,
        prevStx: prevStx,
        prevTerms: prevTerms
    });
}
function rewindOpCtx(opCtx, res) {
    // If we've consumed all pending operators, we can just start over.
    // It's important that we always thread the new prevStx and prevTerms
    // through, otherwise the old ones will still persist.
    if (!res.prevTerms.length || !res.prevTerms[0].isPartial) {
        return _.extend({}, opCtx, {
            combine: function (t) {
                return {
                    term: t,
                    prevStx: res.prevStx,
                    prevTerms: res.prevTerms
                };
            },
            prec: 0,
            op: null,
            stack: [],
            prevStx: res.prevStx,
            prevTerms: res.prevTerms
        });
    }
    // To rewind, we need to find the first (previous) pending operator. It
    // acts as a marker in the opCtx to let us know how far we need to go
    // back.
    var op = null;
    for (var i = 0; i < res.prevTerms.length; i++) {
        if (!res.prevTerms[i].isPartial) {
            break;
        }
        if (res.prevTerms[i].isPartialOperation) {
            op = res.prevTerms[i];
            break;
        }
    }
    // If the op matches the current opCtx, we don't need to rewind
    // anything, but we still need to persist the prevStx and prevTerms.
    if (opCtx.op === op) {
        return _.extend({}, opCtx, {
            prevStx: res.prevStx,
            prevTerms: res.prevTerms
        });
    }
    for (var i = 0; i < opCtx.stack.length; i++) {
        if (opCtx.stack[i].op === op) {
            return _.extend({}, opCtx.stack[i], {
                prevStx: res.prevStx,
                prevTerms: res.prevTerms
            });
        }
    }
    assert(false, 'Rewind failed.');
}
function get_expression(stx, context) {
    if (stx[0].term) {
        for (var termLen = 1; termLen < stx.length; termLen++) {
            if (stx[termLen].term !== stx[0].term) {
                break;
            }
        }
        // Guard the termLen because we can have a multi-token term that
        // we don't want to split. TODO: is there something we can do to
        // get around this safely?
        if (stx[0].term.isPartialExpression && termLen === stx[0].term.stx.length) {
            var expr = stx[0].term.combine().result;
            for (var i = 1, term = stx[0].term; i < stx.length; i++) {
                if (stx[i].term !== term) {
                    if (term && term.isPartial) {
                        term = term.left;
                        i--;
                    } else {
                        break;
                    }
                }
            }
            return {
                result: expr,
                rest: stx.slice(i)
            };
        } else if (stx[0].term.isExpr) {
            return {
                result: stx[0].term,
                rest: stx.slice(termLen)
            };
        } else {
            return {
                result: null,
                rest: stx
            };
        }
    }
    var res = enforest(stx, context);
    if (!res.result || !res.result.isExpr) {
        return {
            result: null,
            rest: stx
        };
    }
    return res;
}
function tagWithTerm(term, stx) {
    return stx.map(function (s) {
        var src = s.token;
        var keys = Object.keys(src);
        var newtok = {};
        for (var i = 0, len = keys.length, key; i < len; i++) {
            key = keys[i];
            newtok[key] = src[key];
        }
        s = syntaxFromToken(newtok, s);
        s.term = term;
        return s;
    });
}
// mark each syntax object in the pattern environment,
// mutating the environment
function applyMarkToPatternEnv(newMark, env) {
    /*
        Takes a `match` object:

            {
                level: <num>,
                match: [<match> or <syntax>]
            }

        where the match property is an array of syntax objects at the bottom (0) level.
        Does a depth-first search and applys the mark to each syntax object.
        */
    function dfs(match) {
        if (match.level === 0) {
            // replace the match property with the marked syntax
            match.match = _.map(match.match, function (stx) {
                return stx.mark(newMark);
            });
        } else {
            _.each(match.match, function (match$2) {
                dfs(match$2);
            });
        }
    }
    _.keys(env).forEach(function (key) {
        dfs(env[key]);
    });
}
// given the syntax for a macro, produce a macro transformer
// (Macro) -> (([...CSyntax]) -> ReadTree)
function loadMacroDef(body, context) {
    // raw function primitive form
    if (!(body[0] && body[0].token.type === parser.Token.Keyword && body[0].token.value === 'function')) {
        throwSyntaxError('load macro', 'Primitive macro form must contain a function for the macro body', body);
    }
    var stub = parser.read('()');
    stub[0].token.inner = body;
    var expanded = expand(stub, context);
    expanded = expanded[0].destruct().concat(expanded[1].eof);
    var flattend = flatten(expanded);
    var bodyCode = codegen.generate(parser.parse(flattend));
    var macroFn = scopedEval(bodyCode, {
            makeValue: syn.makeValue,
            makeRegex: syn.makeRegex,
            makeIdent: syn.makeIdent,
            makeKeyword: syn.makeKeyword,
            makePunc: syn.makePunc,
            makeDelim: syn.makeDelim,
            require: function (id) {
                if (context.requireModule) {
                    return context.requireModule(id, context.filename);
                }
                return _dereq_(id);
            },
            getExpr: function (stx) {
                var r;
                if (stx.length === 0) {
                    return {
                        success: false,
                        result: [],
                        rest: []
                    };
                }
                r = get_expression(stx, context);
                return {
                    success: r.result !== null,
                    result: r.result === null ? [] : r.result.destruct(),
                    rest: r.rest
                };
            },
            getIdent: function (stx) {
                if (stx[0] && stx[0].token.type === parser.Token.Identifier) {
                    return {
                        success: true,
                        result: [stx[0]],
                        rest: stx.slice(1)
                    };
                }
                return {
                    success: false,
                    result: [],
                    rest: stx
                };
            },
            getLit: function (stx) {
                if (stx[0] && patternModule.typeIsLiteral(stx[0].token.type)) {
                    return {
                        success: true,
                        result: [stx[0]],
                        rest: stx.slice(1)
                    };
                }
                return {
                    success: false,
                    result: [],
                    rest: stx
                };
            },
            unwrapSyntax: syn.unwrapSyntax,
            throwSyntaxError: throwSyntaxError,
            throwSyntaxCaseError: throwSyntaxCaseError,
            prettyPrint: syn.prettyPrint,
            parser: parser,
            __fresh: fresh,
            _: _,
            patternModule: patternModule,
            getPattern: function (id) {
                return context.patternMap.get(id);
            },
            getTemplate: function (id) {
                return syn.cloneSyntaxArray(context.templateMap.get(id));
            },
            applyMarkToPatternEnv: applyMarkToPatternEnv,
            mergeMatches: function (newMatch, oldMatch) {
                newMatch.patternEnv = _.extend({}, oldMatch.patternEnv, newMatch.patternEnv);
                return newMatch;
            }
        });
    return macroFn;
}
// similar to `parse1` in the honu paper
// ([Syntax], Map) -> {terms: [TermTree], env: Map}
function expandToTermTree(stx, context) {
    assert(context, 'expander context is required');
    var f, head, prevStx, restStx, prevTerms, macroDefinition;
    var rest = stx;
    while (rest.length > 0) {
        assert(rest[0].token, 'expecting a syntax object');
        f = enforest(rest, context, prevStx, prevTerms);
        // head :: TermTree
        head = f.result;
        // rest :: [Syntax]
        rest = f.rest;
        if (!head) {
            // no head means the expansions stopped prematurely (for stepping)
            restStx = rest;
            break;
        }
        if (head.isMacro && expandCount < maxExpands) {
            // load the macro definition into the environment and continue expanding
            macroDefinition = loadMacroDef(head.body, context);
            var name = head.name.map(unwrapSyntax).join('');
            var nameStx = syn.makeIdent(name, head.name[0]);
            addToDefinitionCtx([nameStx], context.defscope, false, context.paramscope);
            context.env.names.set(name, true);
            context.env.set(resolve(nameStx), {
                fn: macroDefinition,
                isOp: false,
                builtin: builtinMode,
                fullName: head.name
            });
            continue;
        }
        if (head.isLetMacro && expandCount < maxExpands) {
            // load the macro definition into the environment and continue expanding
            macroDefinition = loadMacroDef(head.body, context);
            var freshName = fresh();
            var name = head.name.map(unwrapSyntax).join('');
            var nameStx = syn.makeIdent(name, head.name[0]);
            var renamedName = nameStx.rename(nameStx, freshName);
            rest = _.map(rest, function (stx$2) {
                return stx$2.rename(nameStx, freshName);
            });
            context.env.names.set(name, true);
            context.env.set(resolve(renamedName), {
                fn: macroDefinition,
                isOp: false,
                builtin: builtinMode,
                fullName: head.name
            });
            continue;
        }
        if (head.isOperatorDefinition) {
            var opDefinition = loadMacroDef(head.body, context);
            var name = head.name.map(unwrapSyntax).join('');
            var nameStx = syn.makeIdent(name, head.name[0]);
            addToDefinitionCtx([nameStx], context.defscope, false, context.paramscope);
            var resolvedName = resolve(nameStx);
            var opObj = context.env.get(resolvedName);
            if (!opObj) {
                opObj = {
                    isOp: true,
                    builtin: builtinMode,
                    fullName: head.name
                };
            }
            assert(head.type === 'binary' || head.type === 'unary', 'operator must either be binary or unary');
            opObj[head.type] = {
                fn: opDefinition,
                prec: head.prec.token.value,
                assoc: head.assoc ? head.assoc.token.value : null
            };
            context.env.names.set(name, true);
            context.env.set(resolvedName, opObj);
            continue;
        }
        // We build the newPrevTerms/Stx here (instead of at the beginning) so
        // that macro definitions don't get added to it.
        var destructed = tagWithTerm(head, f.result.destruct());
        prevTerms = [head].concat(f.prevTerms);
        prevStx = destructed.reverse().concat(f.prevStx);
        if (head.isNamedFun) {
            addToDefinitionCtx([head.name], context.defscope, true, context.paramscope);
        }
        if (head.isVariableStatement || head.isLetStatement || head.isConstStatement) {
            addToDefinitionCtx(_.map(head.decls, function (decl) {
                return decl.ident;
            }), context.defscope, true, context.paramscope);
        }
        if (head.isBlock && head.body.isDelimiter) {
            head.body.delim.token.inner.forEach(function (term) {
                if (term.isVariableStatement) {
                    addToDefinitionCtx(_.map(term.decls, function (decl) {
                        return decl.ident;
                    }), context.defscope, true, context.paramscope);
                }
            });
        }
        if (head.isDelimiter) {
            head.delim.token.inner.forEach(function (term) {
                if (term.isVariableStatement) {
                    addToDefinitionCtx(_.map(term.decls, function (decl) {
                        return decl.ident;
                    }), context.defscope, true, context.paramscope);
                }
            });
        }
        if (head.isForStatement) {
            head.cond.expose();
            var forCond = head.cond.token.inner;
            if (forCond[0] && resolve(forCond[0]) === 'let' && forCond[1] && forCond[1].token.type === parser.Token.Identifier) {
                var letNew = fresh();
                var letId = forCond[1];
                forCond = forCond.map(function (stx$2) {
                    return stx$2.rename(letId, letNew);
                });
                // hack: we want to do the let renaming here, not
                // in the expansion of `for (...)` so just remove the `let`
                // keyword
                head.cond.token.inner = expand([forCond[0]], context).concat(expand(forCond.slice(1), context));
                // nice and easy case: `for (...) { ... }`
                if (rest[0] && rest[0].token.value === '{}') {
                    rest[0] = rest[0].rename(letId, letNew);
                } else {
                    // need to deal with things like `for (...) if (...) log(...)`
                    var bodyEnf = enforest(rest, context);
                    var bodyDestructed = bodyEnf.result.destruct();
                    var renamedBodyTerm = bodyEnf.result.rename(letId, letNew);
                    tagWithTerm(renamedBodyTerm, bodyDestructed);
                    rest = bodyEnf.rest;
                    prevStx = bodyDestructed.reverse().concat(prevStx);
                    prevTerms = [renamedBodyTerm].concat(prevTerms);
                }
            } else {
                head.cond.token.inner = expand(head.cond.token.inner, context);
            }
        }
    }
    return {
        terms: prevTerms ? prevTerms.reverse() : [],
        restStx: restStx,
        context: context
    };
}
function addToDefinitionCtx(idents, defscope, skipRep, paramscope) {
    assert(idents && idents.length > 0, 'expecting some variable identifiers');
    // flag for skipping repeats since we reuse this function to place both
    // variables declarations (which need to skip redeclarations) and
    // macro definitions which don't
    skipRep = skipRep || false;
    _.chain(idents).filter(function (id) {
        if (skipRep) {
            /*
                       When var declarations repeat in the same function scope:

                       var x = 24;
                       ...
                       var x = 42;

                       we just need to use the first renaming and leave the
                       definition context as is.
                    */
            var varDeclRep = _.find(defscope, function (def) {
                    return def.id.token.value === id.token.value && arraysEqual(marksof(def.id.context), marksof(id.context));
                });
            /* 
                        When var declaration repeat one of the function parameters:

                        function foo(x) {
                            var x;
                        }

                        we don't need to add the var to the definition context.
                    */
            var paramDeclRep = _.find(paramscope, function (param) {
                    return param.token.value === id.token.value && arraysEqual(marksof(param.context), marksof(id.context));
                });
            return typeof varDeclRep === 'undefined' && typeof paramDeclRep === 'undefined';
        }
        return true;
    }).each(function (id) {
        var name = fresh();
        defscope.push({
            id: id,
            name: name
        });
    });
}
// similar to `parse2` in the honu paper except here we
// don't generate an AST yet
// (TermTree, Map, Map) -> TermTree
function expandTermTreeToFinal(term, context) {
    assert(context && context.env, 'environment map is required');
    if (term.isArrayLiteral) {
        term.array.delim.token.inner = expand(term.array.delim.expose().token.inner, context);
        return term;
    } else if (term.isBlock) {
        term.body.delim.token.inner = expand(term.body.delim.expose().token.inner, context);
        return term;
    } else if (term.isParenExpression) {
        term.args = _.map(term.args, function (arg) {
            return expandTermTreeToFinal(arg, context);
        });
        return term;
    } else if (term.isCall) {
        term.fun = expandTermTreeToFinal(term.fun, context);
        term.args = expandTermTreeToFinal(term.args, context);
        return term;
    } else if (term.isReturnStatement) {
        term.expr = expandTermTreeToFinal(term.expr, context);
        return term;
    } else if (term.isUnaryOp) {
        term.expr = expandTermTreeToFinal(term.expr, context);
        return term;
    } else if (term.isBinOp || term.isAssignmentExpression) {
        term.left = expandTermTreeToFinal(term.left, context);
        term.right = expandTermTreeToFinal(term.right, context);
        return term;
    } else if (term.isObjGet) {
        term.left = expandTermTreeToFinal(term.left, context);
        term.right.delim.token.inner = expand(term.right.delim.expose().token.inner, context);
        return term;
    } else if (term.isObjDotGet) {
        term.left = expandTermTreeToFinal(term.left, context);
        term.right = expandTermTreeToFinal(term.right, context);
        return term;
    } else if (term.isConditionalExpression) {
        term.cond = expandTermTreeToFinal(term.cond, context);
        term.tru = expandTermTreeToFinal(term.tru, context);
        term.fls = expandTermTreeToFinal(term.fls, context);
        return term;
    } else if (term.isVariableDeclaration) {
        if (term.init) {
            term.init = expandTermTreeToFinal(term.init, context);
        }
        return term;
    } else if (term.isVariableStatement) {
        term.decls = _.map(term.decls, function (decl) {
            return expandTermTreeToFinal(decl, context);
        });
        return term;
    } else if (term.isDelimiter) {
        // expand inside the delimiter and then continue on
        term.delim.token.inner = expand(term.delim.expose().token.inner, context);
        return term;
    } else if (term.isNamedFun || term.isAnonFun || term.isCatchClause || term.isArrowFun || term.isModule) {
        // function definitions need a bunch of hygiene logic
        // push down a fresh definition context
        var newDef = [];
        var paramSingleIdent = term.params && term.params.token.type === parser.Token.Identifier;
        var params;
        if (term.params && term.params.token.type === parser.Token.Delimiter) {
            params = term.params.expose();
        } else if (paramSingleIdent) {
            params = term.params;
        } else {
            params = syn.makeDelim('()', [], null);
        }
        var bodies;
        if (Array.isArray(term.body)) {
            bodies = syn.makeDelim('{}', term.body, null);
        } else {
            bodies = term.body;
        }
        bodies = bodies.addDefCtx(newDef);
        var paramNames = _.map(getParamIdentifiers(params), function (param) {
                var freshName = fresh();
                return {
                    freshName: freshName,
                    originalParam: param,
                    renamedParam: param.rename(param, freshName)
                };
            });
        var bodyContext = makeExpanderContext(_.defaults({
                defscope: newDef,
                paramscope: paramNames.map(function (p) {
                    return p.renamedParam;
                })
            }, context));
        // rename the function body for each of the parameters
        var renamedBody = _.reduce(paramNames, function (accBody, p) {
                return accBody.rename(p.originalParam, p.freshName);
            }, bodies);
        renamedBody = renamedBody.expose();
        var expandedResult = expandToTermTree(renamedBody.token.inner, bodyContext);
        var bodyTerms = expandedResult.terms;
        if (expandedResult.restStx) {
            // The expansion was halted prematurely. Just stop and
            // return what we have so far, along with the rest of the syntax
            renamedBody.token.inner = expandedResult.terms.concat(expandedResult.restStx);
            if (Array.isArray(term.body)) {
                term.body = renamedBody.token.inner;
            } else {
                term.body = renamedBody;
            }
            return term;
        }
        var renamedParams = _.map(paramNames, function (p) {
                return p.renamedParam;
            });
        var flatArgs;
        if (paramSingleIdent) {
            flatArgs = renamedParams[0];
        } else {
            flatArgs = syn.makeDelim('()', joinSyntax(renamedParams, ','), term.params || null);
        }
        var expandedArgs = expand([flatArgs], bodyContext);
        assert(expandedArgs.length === 1, 'should only get back one result');
        // stitch up the function with all the renamings
        if (term.params) {
            term.params = expandedArgs[0];
        }
        bodyTerms = _.map(bodyTerms, function (bodyTerm) {
            // add the definition context to the result of
            // expansion (this makes sure that syntax objects
            // introduced by expansion have the def context)
            if (bodyTerm.isBlock) {
                // we need to expand blocks before adding the defctx since
                // blocks defer macro expansion.
                var blockFinal = expandTermTreeToFinal(bodyTerm, expandedResult.context);
                return blockFinal.addDefCtx(newDef);
            } else {
                var termWithCtx = bodyTerm.addDefCtx(newDef);
                // finish expansion
                return expandTermTreeToFinal(termWithCtx, expandedResult.context);
            }
        });
        if (term.isModule) {
            bodyTerms = _.filter(bodyTerms, function (bodyTerm) {
                if (bodyTerm.isExport) {
                    term.exports.push(bodyTerm);
                    return false;
                } else {
                    return true;
                }
            });
        }
        renamedBody.token.inner = bodyTerms;
        if (Array.isArray(term.body)) {
            term.body = renamedBody.token.inner;
        } else {
            term.body = renamedBody;
        }
        // and continue expand the rest
        return term;
    }
    // the term is fine as is
    return term;
}
// similar to `parse` in the honu paper
// ([Syntax], Map, Map) -> [TermTree]
function expand(stx, context) {
    assert(context, 'must provide an expander context');
    var trees = expandToTermTree(stx, context);
    var terms = _.map(trees.terms, function (term) {
            return expandTermTreeToFinal(term, trees.context);
        });
    if (trees.restStx) {
        terms.push.apply(terms, trees.restStx);
    }
    return terms;
}
function makeExpanderContext(o) {
    o = o || {};
    var env = o.env || new StringMap();
    if (!env.names) {
        env.names = new StringMap();
    }
    // read-only but can enumerate
    return Object.create(Object.prototype, {
        filename: {
            value: o.filename,
            writable: false,
            enumerable: true,
            configurable: false
        },
        requireModule: {
            value: o.requireModule,
            writable: false,
            enumerable: true,
            configurable: false
        },
        env: {
            value: env,
            writable: false,
            enumerable: true,
            configurable: false
        },
        defscope: {
            value: o.defscope,
            writable: false,
            enumerable: true,
            configurable: false
        },
        paramscope: {
            value: o.paramscope,
            writable: false,
            enumerable: true,
            configurable: false
        },
        templateMap: {
            value: o.templateMap || new StringMap(),
            writable: false,
            enumerable: true,
            configurable: false
        },
        patternMap: {
            value: o.patternMap || new StringMap(),
            writable: false,
            enumerable: true,
            configurable: false
        },
        mark: {
            value: o.mark,
            writable: false,
            enumerable: true,
            configurable: false
        }
    });
}
function makeTopLevelExpanderContext(options) {
    var requireModule = options ? options.requireModule : undefined;
    var filename = options ? options.filename : undefined;
    return makeExpanderContext({
        filename: filename,
        requireModule: requireModule
    });
}
// a hack to make the top level hygiene work out
function expandTopLevel(stx, moduleContexts, options) {
    moduleContexts = moduleContexts || [];
    options = options || {};
    options.flatten = options.flatten != null ? options.flatten : true;
    maxExpands = options.maxExpands || Infinity;
    expandCount = 0;
    var context = makeTopLevelExpanderContext(options);
    var modBody = syn.makeDelim('{}', stx, null);
    modBody = _.reduce(moduleContexts, function (acc, mod) {
        context.env.extend(mod.env);
        context.env.names.extend(mod.env.names);
        return loadModuleExports(acc, context.env, mod.exports, mod.env);
    }, modBody);
    var res = expand([
            syn.makeIdent('module', null),
            modBody
        ], context);
    res = res[0].destruct();
    res = res[0].token.inner;
    return options.flatten ? flatten(res) : res;
}
function expandModule(stx, moduleContexts, options) {
    moduleContexts = moduleContexts || [];
    maxExpands = Infinity;
    expandCount = 0;
    var context = makeTopLevelExpanderContext(options);
    var modBody = syn.makeDelim('{}', stx, null);
    modBody = _.reduce(moduleContexts, function (acc, mod) {
        context.env.extend(mod.env);
        context.env.names.extend(mod.env.names);
        return loadModuleExports(acc, context.env, mod.exports, mod.env);
    }, modBody);
    builtinMode = true;
    var moduleRes = expand([
            syn.makeIdent('module', null),
            modBody
        ], context);
    builtinMode = false;
    context.exports = _.map(moduleRes[0].exports, function (term) {
        var nameStr, name;
        if (term.name.token.type === parser.Token.Delimiter) {
            nameStr = term.name.token.inner.map(unwrapSyntax).join('');
            name = syn.makeIdent(nameStr, term.name);
        } else {
            name = term.name;
            nameStr = unwrapSyntax(name);
        }
        return {
            oldExport: name,
            newParam: syn.makeIdent(nameStr, null)
        };
    });
    return context;
}
function loadModuleExports(stx, newEnv, exports$2, oldEnv) {
    return _.reduce(exports$2, function (acc, param) {
        var newName = fresh();
        var transformer = oldEnv.get(resolve(param.oldExport));
        if (transformer) {
            newEnv.set(resolve(param.newParam.rename(param.newParam, newName)), transformer);
            return acc.rename(param.newParam, newName);
        } else {
            return acc;
        }
    }, stx);
}
// break delimiter tree structure down to flat array of syntax objects
function flatten(stx) {
    return _.reduce(stx, function (acc, stx$2) {
        if (stx$2.token.type === parser.Token.Delimiter) {
            var exposed = stx$2.expose();
            var openParen = syntaxFromToken({
                    type: parser.Token.Punctuator,
                    value: stx$2.token.value[0],
                    range: stx$2.token.startRange,
                    sm_range: typeof stx$2.token.sm_startRange == 'undefined' ? stx$2.token.startRange : stx$2.token.sm_startRange,
                    lineNumber: stx$2.token.startLineNumber,
                    sm_lineNumber: typeof stx$2.token.sm_startLineNumber == 'undefined' ? stx$2.token.startLineNumber : stx$2.token.sm_startLineNumber,
                    lineStart: stx$2.token.startLineStart,
                    sm_lineStart: typeof stx$2.token.sm_startLineStart == 'undefined' ? stx$2.token.startLineStart : stx$2.token.sm_startLineStart
                }, exposed);
            var closeParen = syntaxFromToken({
                    type: parser.Token.Punctuator,
                    value: stx$2.token.value[1],
                    range: stx$2.token.endRange,
                    sm_range: typeof stx$2.token.sm_endRange == 'undefined' ? stx$2.token.endRange : stx$2.token.sm_endRange,
                    lineNumber: stx$2.token.endLineNumber,
                    sm_lineNumber: typeof stx$2.token.sm_endLineNumber == 'undefined' ? stx$2.token.endLineNumber : stx$2.token.sm_endLineNumber,
                    lineStart: stx$2.token.endLineStart,
                    sm_lineStart: typeof stx$2.token.sm_endLineStart == 'undefined' ? stx$2.token.endLineStart : stx$2.token.sm_endLineStart
                }, exposed);
            if (stx$2.token.leadingComments) {
                openParen.token.leadingComments = stx$2.token.leadingComments;
            }
            if (stx$2.token.trailingComments) {
                openParen.token.trailingComments = stx$2.token.trailingComments;
            }
            acc.push(openParen);
            push.apply(acc, flatten(exposed.token.inner));
            acc.push(closeParen);
            return acc;
        }
        stx$2.token.sm_lineNumber = stx$2.token.sm_lineNumber ? stx$2.token.sm_lineNumber : stx$2.token.lineNumber;
        stx$2.token.sm_lineStart = stx$2.token.sm_lineStart ? stx$2.token.sm_lineStart : stx$2.token.lineStart;
        stx$2.token.sm_range = stx$2.token.sm_range ? stx$2.token.sm_range : stx$2.token.range;
        acc.push(stx$2);
        return acc;
    }, []);
}
exports.StringMap = StringMap;
exports.enforest = enforest;
exports.expand = expandTopLevel;
exports.expandModule = expandModule;
exports.resolve = resolve;
exports.get_expression = get_expression;
exports.getName = getName;
exports.getMacroInEnv = getMacroInEnv;
exports.nameInEnv = nameInEnv;
exports.makeExpanderContext = makeExpanderContext;
exports.Expr = Expr;
exports.VariableStatement = VariableStatement;
exports.tokensToSyntax = syn.tokensToSyntax;
exports.syntaxToTokens = syn.syntaxToTokens;
//# sourceMappingURL=expander.js.map
},{"./parser":2,"./patterns":3,"./scopedEval":4,"./syntax":6,"escodegen":7,"underscore":33}],2:[function(_dereq_,module,exports){
/*
  Copyright (C) 2013 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2013 Thaddee Tyl <thaddee.tyl@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>
  Copyright (C) 2011 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
/*global esprima:true, define:true, exports:true, window: true,
throwError: true, generateStatement: true, peek: true,
parseAssignmentExpression: true, parseBlock: true,
parseClassExpression: true, parseClassDeclaration: true, parseExpression: true,
parseForStatement: true,
parseFunctionDeclaration: true, parseFunctionExpression: true,
parseFunctionSourceElements: true, parseVariableIdentifier: true,
parseImportSpecifier: true,
parseLeftHandSideExpression: true, parseParams: true, validateParam: true,
parseSpreadOrAssignmentExpression: true,
parseStatement: true, parseSourceElement: true, parseModuleBlock: true, parseConciseBody: true,
parseYieldExpression: true
*/
'use strict';
var expander = _dereq_('./expander');
var Token, TokenName, FnExprTokens, Syntax, PropertyKind, Messages, Regex, SyntaxTreeDelegate, ClassPropertyType, source, strict, index, lineNumber, lineStart, sm_lineNumber, sm_lineStart, sm_range, sm_index, length, delegate, tokenStream, streamIndex, lookahead, lookaheadIndex, state, extra;
Token = {
    BooleanLiteral: 1,
    EOF: 2,
    Identifier: 3,
    Keyword: 4,
    NullLiteral: 5,
    NumericLiteral: 6,
    Punctuator: 7,
    StringLiteral: 8,
    RegularExpression: 9,
    Template: 10,
    Delimiter: 11
};
TokenName = {};
TokenName[Token.BooleanLiteral] = 'Boolean';
TokenName[Token.EOF] = '<end>';
TokenName[Token.Identifier] = 'Identifier';
TokenName[Token.Keyword] = 'Keyword';
TokenName[Token.NullLiteral] = 'Null';
TokenName[Token.NumericLiteral] = 'Numeric';
TokenName[Token.Punctuator] = 'Punctuator';
TokenName[Token.StringLiteral] = 'String';
TokenName[Token.RegularExpression] = 'RegularExpression';
TokenName[Token.Delimiter] = 'Delimiter';
// A function following one of those tokens is an expression.
FnExprTokens = [
    '(',
    '{',
    '[',
    'in',
    'typeof',
    'instanceof',
    'new',
    'return',
    'case',
    'delete',
    'throw',
    'void',
    '=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '<<=',
    '>>=',
    '>>>=',
    '&=',
    '|=',
    '^=',
    ',',
    '+',
    '-',
    '*',
    '/',
    '%',
    '++',
    '--',
    '<<',
    '>>',
    '>>>',
    '&',
    '|',
    '^',
    '!',
    '~',
    '&&',
    '||',
    '?',
    ':',
    '===',
    '==',
    '>=',
    '<=',
    '<',
    '>',
    '!=',
    '!=='
];
Syntax = {
    ArrayExpression: 'ArrayExpression',
    ArrayPattern: 'ArrayPattern',
    ArrowFunctionExpression: 'ArrowFunctionExpression',
    AssignmentExpression: 'AssignmentExpression',
    BinaryExpression: 'BinaryExpression',
    BlockStatement: 'BlockStatement',
    BreakStatement: 'BreakStatement',
    CallExpression: 'CallExpression',
    CatchClause: 'CatchClause',
    ClassBody: 'ClassBody',
    ClassDeclaration: 'ClassDeclaration',
    ClassExpression: 'ClassExpression',
    ClassHeritage: 'ClassHeritage',
    ComprehensionBlock: 'ComprehensionBlock',
    ComprehensionExpression: 'ComprehensionExpression',
    ConditionalExpression: 'ConditionalExpression',
    ContinueStatement: 'ContinueStatement',
    DebuggerStatement: 'DebuggerStatement',
    DoWhileStatement: 'DoWhileStatement',
    EmptyStatement: 'EmptyStatement',
    ExportDeclaration: 'ExportDeclaration',
    ExportBatchSpecifier: 'ExportBatchSpecifier',
    ExportSpecifier: 'ExportSpecifier',
    ExpressionStatement: 'ExpressionStatement',
    ForInStatement: 'ForInStatement',
    ForOfStatement: 'ForOfStatement',
    ForStatement: 'ForStatement',
    FunctionDeclaration: 'FunctionDeclaration',
    FunctionExpression: 'FunctionExpression',
    Identifier: 'Identifier',
    IfStatement: 'IfStatement',
    ImportDeclaration: 'ImportDeclaration',
    ImportSpecifier: 'ImportSpecifier',
    LabeledStatement: 'LabeledStatement',
    Literal: 'Literal',
    LogicalExpression: 'LogicalExpression',
    MemberExpression: 'MemberExpression',
    MethodDefinition: 'MethodDefinition',
    ModuleDeclaration: 'ModuleDeclaration',
    NewExpression: 'NewExpression',
    ObjectExpression: 'ObjectExpression',
    ObjectPattern: 'ObjectPattern',
    Program: 'Program',
    Property: 'Property',
    ReturnStatement: 'ReturnStatement',
    SequenceExpression: 'SequenceExpression',
    SpreadElement: 'SpreadElement',
    SwitchCase: 'SwitchCase',
    SwitchStatement: 'SwitchStatement',
    TaggedTemplateExpression: 'TaggedTemplateExpression',
    TemplateElement: 'TemplateElement',
    TemplateLiteral: 'TemplateLiteral',
    ThisExpression: 'ThisExpression',
    ThrowStatement: 'ThrowStatement',
    TryStatement: 'TryStatement',
    UnaryExpression: 'UnaryExpression',
    UpdateExpression: 'UpdateExpression',
    VariableDeclaration: 'VariableDeclaration',
    VariableDeclarator: 'VariableDeclarator',
    WhileStatement: 'WhileStatement',
    WithStatement: 'WithStatement',
    YieldExpression: 'YieldExpression'
};
PropertyKind = {
    Data: 1,
    Get: 2,
    Set: 4
};
ClassPropertyType = {
    'static': 'static',
    prototype: 'prototype'
};
// Error messages should be identical to V8.
Messages = {
    UnexpectedToken: 'Unexpected token %0',
    UnexpectedNumber: 'Unexpected number',
    UnexpectedString: 'Unexpected string',
    UnexpectedIdentifier: 'Unexpected identifier',
    UnexpectedReserved: 'Unexpected reserved word',
    UnexpectedTemplate: 'Unexpected quasi %0',
    UnexpectedEOS: 'Unexpected end of input',
    NewlineAfterThrow: 'Illegal newline after throw',
    InvalidRegExp: 'Invalid regular expression',
    UnterminatedRegExp: 'Invalid regular expression: missing /',
    InvalidLHSInAssignment: 'Invalid left-hand side in assignment',
    InvalidLHSInFormalsList: 'Invalid left-hand side in formals list',
    InvalidLHSInForIn: 'Invalid left-hand side in for-in',
    MultipleDefaultsInSwitch: 'More than one default clause in switch statement',
    NoCatchOrFinally: 'Missing catch or finally after try',
    UnknownLabel: 'Undefined label \'%0\'',
    Redeclaration: '%0 \'%1\' has already been declared',
    IllegalContinue: 'Illegal continue statement',
    IllegalBreak: 'Illegal break statement',
    IllegalDuplicateClassProperty: 'Illegal duplicate property in class definition',
    IllegalReturn: 'Illegal return statement',
    IllegalYield: 'Illegal yield expression',
    IllegalSpread: 'Illegal spread element',
    StrictModeWith: 'Strict mode code may not include a with statement',
    StrictCatchVariable: 'Catch variable may not be eval or arguments in strict mode',
    StrictVarName: 'Variable name may not be eval or arguments in strict mode',
    StrictParamName: 'Parameter name eval or arguments is not allowed in strict mode',
    StrictParamDupe: 'Strict mode function may not have duplicate parameter names',
    ParameterAfterRestParameter: 'Rest parameter must be final parameter of an argument list',
    DefaultRestParameter: 'Rest parameter can not have a default value',
    ElementAfterSpreadElement: 'Spread must be the final element of an element list',
    ObjectPatternAsRestParameter: 'Invalid rest parameter',
    ObjectPatternAsSpread: 'Invalid spread argument',
    StrictFunctionName: 'Function name may not be eval or arguments in strict mode',
    StrictOctalLiteral: 'Octal literals are not allowed in strict mode.',
    StrictDelete: 'Delete of an unqualified identifier in strict mode.',
    StrictDuplicateProperty: 'Duplicate data property in object literal not allowed in strict mode',
    AccessorDataProperty: 'Object literal may not have data and accessor property with the same name',
    AccessorGetSet: 'Object literal may not have multiple get/set accessors with the same name',
    StrictLHSAssignment: 'Assignment to eval or arguments is not allowed in strict mode',
    StrictLHSPostfix: 'Postfix increment/decrement may not have eval or arguments operand in strict mode',
    StrictLHSPrefix: 'Prefix increment/decrement may not have eval or arguments operand in strict mode',
    StrictReservedWord: 'Use of future reserved word in strict mode',
    NewlineAfterModule: 'Illegal newline after module',
    NoFromAfterImport: 'Missing from after import',
    InvalidModuleSpecifier: 'Invalid module specifier',
    NestedModule: 'Module declaration can not be nested',
    NoYieldInGenerator: 'Missing yield in generator',
    NoUnintializedConst: 'Const must be initialized',
    ComprehensionRequiresBlock: 'Comprehension must have at least one block',
    ComprehensionError: 'Comprehension Error',
    EachNotAllowed: 'Each is not supported',
    UnmatchedDelimiter: 'Unmatched Delimiter'
};
// See also tools/generate-unicode-regex.py.
Regex = {
    NonAsciiIdentifierStart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]'),
    NonAsciiIdentifierPart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]')
};
// Ensure the condition is true, otherwise throw an error.
// This is only to have a better contract semantic, i.e. another safety net
// to catch a logic error. The condition shall be fulfilled in normal case.
// Do NOT use this to enforce a certain condition on any user input.
function assert(condition, message) {
    if (!condition) {
        throw new Error('ASSERT: ' + message);
    }
}
function isIn(el, list) {
    return list.indexOf(el) !== -1;
}
function isDecimalDigit(ch) {
    return ch >= 48 && ch <= 57;
}    // 0..9
function isHexDigit(ch) {
    return '0123456789abcdefABCDEF'.indexOf(ch) >= 0;
}
function isOctalDigit(ch) {
    return '01234567'.indexOf(ch) >= 0;
}
// 7.2 White Space
function isWhiteSpace(ch) {
    return ch === 32 || ch === 9 || ch === 11 || ch === 12 || ch === 160 || ch >= 5760 && '\u1680\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\uFEFF'.indexOf(String.fromCharCode(ch)) > 0;
}
// 7.3 Line Terminators
function isLineTerminator(ch) {
    return ch === 10 || ch === 13 || ch === 8232 || ch === 8233;
}
// 7.6 Identifier Names and Identifiers
function isIdentifierStart(ch) {
    return ch === 36 || ch === 95 || ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122 || ch === 92 || ch >= 128 && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch));
}
function isIdentifierPart(ch) {
    return ch === 36 || ch === 95 || ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122 || ch >= 48 && ch <= 57 || ch === 92 || ch >= 128 && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch));
}
// 7.6.1.2 Future Reserved Words
function isFutureReservedWord(id) {
    switch (id) {
    case 'class':
    case 'enum':
    case 'export':
    case 'extends':
    case 'import':
    case 'super':
        return true;
    default:
        return false;
    }
}
function isStrictModeReservedWord(id) {
    switch (id) {
    case 'implements':
    case 'interface':
    case 'package':
    case 'private':
    case 'protected':
    case 'public':
    case 'static':
    case 'yield':
    case 'let':
        return true;
    default:
        return false;
    }
}
function isRestrictedWord(id) {
    return id === 'eval' || id === 'arguments';
}
// 7.6.1.1 Keywords
function isKeyword(id) {
    if (strict && isStrictModeReservedWord(id)) {
        return true;
    }
    // 'const' is specialized as Keyword in V8.
    // 'yield' and 'let' are for compatiblity with SpiderMonkey and ES.next.
    // Some others are from future reserved words.
    switch (id.length) {
    case 2:
        return id === 'if' || id === 'in' || id === 'do';
    case 3:
        return id === 'var' || id === 'for' || id === 'new' || id === 'try' || id === 'let';
    case 4:
        return id === 'this' || id === 'else' || id === 'case' || id === 'void' || id === 'with' || id === 'enum';
    case 5:
        return id === 'while' || id === 'break' || id === 'catch' || id === 'throw' || id === 'const' || id === 'yield' || id === 'class' || id === 'super';
    case 6:
        return id === 'return' || id === 'typeof' || id === 'delete' || id === 'switch' || id === 'export' || id === 'import';
    case 7:
        return id === 'default' || id === 'finally' || id === 'extends';
    case 8:
        return id === 'function' || id === 'continue' || id === 'debugger';
    case 10:
        return id === 'instanceof';
    default:
        return false;
    }
}
// 7.4 Comments
function skipComment() {
    var ch, blockComment, lineComment;
    blockComment = false;
    lineComment = false;
    while (index < length) {
        ch = source.charCodeAt(index);
        if (lineComment) {
            ++index;
            if (isLineTerminator(ch)) {
                lineComment = false;
                if (ch === 13 && source.charCodeAt(index) === 10) {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
            }
        } else if (blockComment) {
            if (isLineTerminator(ch)) {
                if (ch === 13 && source.charCodeAt(index + 1) === 10) {
                    ++index;
                }
                ++lineNumber;
                ++index;
                lineStart = index;
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            } else {
                ch = source.charCodeAt(index++);
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                // Block comment ends with '*/' (char #42, char #47).
                if (ch === 42) {
                    ch = source.charCodeAt(index);
                    if (ch === 47) {
                        ++index;
                        blockComment = false;
                    }
                }
            }
        } else if (ch === 47) {
            ch = source.charCodeAt(index + 1);
            // Line comment starts with '//' (char #47, char #47).
            if (ch === 47) {
                index += 2;
                lineComment = true;
            } else if (ch === 42) {
                // Block comment starts with '/*' (char #47, char #42).
                index += 2;
                blockComment = true;
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            } else {
                break;
            }
        } else if (isWhiteSpace(ch)) {
            ++index;
        } else if (isLineTerminator(ch)) {
            ++index;
            if (ch === 13 && source.charCodeAt(index) === 10) {
                ++index;
            }
            ++lineNumber;
            lineStart = index;
        } else {
            break;
        }
    }
}
function scanHexEscape(prefix) {
    var i, len, ch, code = 0;
    len = prefix === 'u' ? 4 : 2;
    for (i = 0; i < len; ++i) {
        if (index < length && isHexDigit(source[index])) {
            ch = source[index++];
            code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
        } else {
            return '';
        }
    }
    return String.fromCharCode(code);
}
function scanUnicodeCodePointEscape() {
    var ch, code, cu1, cu2;
    ch = source[index];
    code = 0;
    // At least, one hex digit is required.
    if (ch === '}') {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    while (index < length) {
        ch = source[index++];
        if (!isHexDigit(ch)) {
            break;
        }
        code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
    }
    if (code > 1114111 || ch !== '}') {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    // UTF-16 Encoding
    if (code <= 65535) {
        return String.fromCharCode(code);
    }
    cu1 = (code - 65536 >> 10) + 55296;
    cu2 = (code - 65536 & 1023) + 56320;
    return String.fromCharCode(cu1, cu2);
}
function getEscapedIdentifier() {
    var ch, id;
    ch = source.charCodeAt(index++);
    id = String.fromCharCode(ch);
    // '\u' (char #92, char #117) denotes an escaped character.
    if (ch === 92) {
        if (source.charCodeAt(index) !== 117) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }
        ++index;
        ch = scanHexEscape('u');
        if (!ch || ch === '\\' || !isIdentifierStart(ch.charCodeAt(0))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }
        id = ch;
    }
    while (index < length) {
        ch = source.charCodeAt(index);
        if (!isIdentifierPart(ch)) {
            break;
        }
        ++index;
        id += String.fromCharCode(ch);
        // '\u' (char #92, char #117) denotes an escaped character.
        if (ch === 92) {
            id = id.substr(0, id.length - 1);
            if (source.charCodeAt(index) !== 117) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            ++index;
            ch = scanHexEscape('u');
            if (!ch || ch === '\\' || !isIdentifierPart(ch.charCodeAt(0))) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            id += ch;
        }
    }
    return id;
}
function getIdentifier() {
    var start, ch;
    start = index++;
    while (index < length) {
        ch = source.charCodeAt(index);
        if (ch === 92) {
            // Blackslash (char #92) marks Unicode escape sequence.
            index = start;
            return getEscapedIdentifier();
        }
        if (isIdentifierPart(ch)) {
            ++index;
        } else {
            break;
        }
    }
    return source.slice(start, index);
}
function scanIdentifier() {
    var start, id, type;
    start = index;
    // Backslash (char #92) starts an escaped character.
    id = source.charCodeAt(index) === 92 ? getEscapedIdentifier() : getIdentifier();
    // There is no keyword or literal with only one character.
    // Thus, it must be an identifier.
    if (id.length === 1) {
        type = Token.Identifier;
    } else if (isKeyword(id)) {
        type = Token.Keyword;
    } else if (id === 'null') {
        type = Token.NullLiteral;
    } else if (id === 'true' || id === 'false') {
        type = Token.BooleanLiteral;
    } else {
        type = Token.Identifier;
    }
    return {
        type: type,
        value: id,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            start,
            index
        ]
    };
}
// 7.7 Punctuators
function scanPunctuator() {
    var start = index, code = source.charCodeAt(index), code2, ch1 = source[index], ch2, ch3, ch4;
    switch (code) {
    // Check for most common single-character punctuators.
    case 40:
    // ( open bracket
    case 41:
    // ) close bracket
    case 59:
    // ; semicolon
    case 44:
    // , comma
    case 123:
    // { open curly brace
    case 125:
    // } close curly brace
    case 91:
    // [
    case 93:
    // ]
    case 58:
    // :
    case 63:
    // ?
    case 126:
        // ~
        ++index;
        if (extra.tokenize) {
            if (code === 40) {
                extra.openParenToken = extra.tokens.length;
            } else if (code === 123) {
                extra.openCurlyToken = extra.tokens.length;
            }
        }
        return {
            type: Token.Punctuator,
            value: String.fromCharCode(code),
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    default:
        code2 = source.charCodeAt(index + 1);
        // '=' (char #61) marks an assignment or comparison operator.
        if (code2 === 61) {
            switch (code) {
            case 37:
            // %
            case 38:
            // &
            case 42:
            // *:
            case 43:
            // +
            case 45:
            // -
            case 47:
            // /
            case 60:
            // <
            case 62:
            // >
            case 94:
            // ^
            case 124:
                // |
                index += 2;
                return {
                    type: Token.Punctuator,
                    value: String.fromCharCode(code) + String.fromCharCode(code2),
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [
                        start,
                        index
                    ]
                };
            case 33:
            // !
            case 61:
                // =
                index += 2;
                // !== and ===
                if (source.charCodeAt(index) === 61) {
                    ++index;
                }
                return {
                    type: Token.Punctuator,
                    value: source.slice(start, index),
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [
                        start,
                        index
                    ]
                };
            default:
                break;
            }
        }
        break;
    }
    // Peek more characters.
    ch2 = source[index + 1];
    ch3 = source[index + 2];
    ch4 = source[index + 3];
    // 4-character punctuator: >>>=
    if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
        if (ch4 === '=') {
            index += 4;
            return {
                type: Token.Punctuator,
                value: '>>>=',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [
                    start,
                    index
                ]
            };
        }
    }
    // 3-character punctuators: === !== >>> <<= >>=
    if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
        index += 3;
        return {
            type: Token.Punctuator,
            value: '>>>',
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    if (ch1 === '<' && ch2 === '<' && ch3 === '=') {
        index += 3;
        return {
            type: Token.Punctuator,
            value: '<<=',
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    if (ch1 === '>' && ch2 === '>' && ch3 === '=') {
        index += 3;
        return {
            type: Token.Punctuator,
            value: '>>=',
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    if (ch1 === '.' && ch2 === '.' && ch3 === '.') {
        index += 3;
        return {
            type: Token.Punctuator,
            value: '...',
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    // Other 2-character punctuators: ++ -- << >> && ||
    if (ch1 === ch2 && '+-<>&|'.indexOf(ch1) >= 0) {
        index += 2;
        return {
            type: Token.Punctuator,
            value: ch1 + ch2,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    if (ch1 === '=' && ch2 === '>') {
        index += 2;
        return {
            type: Token.Punctuator,
            value: '=>',
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    if ('<>=!+-*%&|^/'.indexOf(ch1) >= 0) {
        ++index;
        return {
            type: Token.Punctuator,
            value: ch1,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    if (ch1 === '.') {
        ++index;
        return {
            type: Token.Punctuator,
            value: ch1,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
}
// 7.8.3 Numeric Literals
function scanHexLiteral(start) {
    var number = '';
    while (index < length) {
        if (!isHexDigit(source[index])) {
            break;
        }
        number += source[index++];
    }
    if (number.length === 0) {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    if (isIdentifierStart(source.charCodeAt(index))) {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    return {
        type: Token.NumericLiteral,
        value: parseInt('0x' + number, 16),
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            start,
            index
        ]
    };
}
function scanOctalLiteral(prefix, start) {
    var number, octal;
    if (isOctalDigit(prefix)) {
        octal = true;
        number = '0' + source[index++];
    } else {
        octal = false;
        ++index;
        number = '';
    }
    while (index < length) {
        if (!isOctalDigit(source[index])) {
            break;
        }
        number += source[index++];
    }
    if (!octal && number.length === 0) {
        // only 0o or 0O
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    if (isIdentifierStart(source.charCodeAt(index)) || isDecimalDigit(source.charCodeAt(index))) {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    return {
        type: Token.NumericLiteral,
        value: parseInt(number, 8),
        octal: octal,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            start,
            index
        ]
    };
}
function scanNumericLiteral() {
    var number, start, ch, octal;
    ch = source[index];
    assert(isDecimalDigit(ch.charCodeAt(0)) || ch === '.', 'Numeric literal must start with a decimal digit or a decimal point');
    start = index;
    number = '';
    if (ch !== '.') {
        number = source[index++];
        ch = source[index];
        // Hex number starts with '0x'.
        // Octal number starts with '0'.
        // Octal number in ES6 starts with '0o'.
        // Binary number in ES6 starts with '0b'.
        if (number === '0') {
            if (ch === 'x' || ch === 'X') {
                ++index;
                return scanHexLiteral(start);
            }
            if (ch === 'b' || ch === 'B') {
                ++index;
                number = '';
                while (index < length) {
                    ch = source[index];
                    if (ch !== '0' && ch !== '1') {
                        break;
                    }
                    number += source[index++];
                }
                if (number.length === 0) {
                    // only 0b or 0B
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                if (index < length) {
                    ch = source.charCodeAt(index);
                    if (isIdentifierStart(ch) || isDecimalDigit(ch)) {
                        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                    }
                }
                return {
                    type: Token.NumericLiteral,
                    value: parseInt(number, 2),
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [
                        start,
                        index
                    ]
                };
            }
            if (ch === 'o' || ch === 'O' || isOctalDigit(ch)) {
                return scanOctalLiteral(ch, start);
            }
            // decimal number starts with '0' such as '09' is illegal.
            if (ch && isDecimalDigit(ch.charCodeAt(0))) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
        }
        while (isDecimalDigit(source.charCodeAt(index))) {
            number += source[index++];
        }
        ch = source[index];
    }
    if (ch === '.') {
        number += source[index++];
        while (isDecimalDigit(source.charCodeAt(index))) {
            number += source[index++];
        }
        ch = source[index];
    }
    if (ch === 'e' || ch === 'E') {
        number += source[index++];
        ch = source[index];
        if (ch === '+' || ch === '-') {
            number += source[index++];
        }
        if (isDecimalDigit(source.charCodeAt(index))) {
            while (isDecimalDigit(source.charCodeAt(index))) {
                number += source[index++];
            }
        } else {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }
    }
    if (isIdentifierStart(source.charCodeAt(index))) {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    return {
        type: Token.NumericLiteral,
        value: parseFloat(number),
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            start,
            index
        ]
    };
}
// 7.8.4 String Literals
function scanStringLiteral() {
    var str = '', quote, start, ch, code, unescaped, restore, octal = false;
    quote = source[index];
    assert(quote === '\'' || quote === '"', 'String literal must starts with a quote');
    start = index;
    ++index;
    while (index < length) {
        ch = source[index++];
        if (ch === quote) {
            quote = '';
            break;
        } else if (ch === '\\') {
            ch = source[index++];
            if (!ch || !isLineTerminator(ch.charCodeAt(0))) {
                switch (ch) {
                case 'n':
                    str += '\n';
                    break;
                case 'r':
                    str += '\r';
                    break;
                case 't':
                    str += '\t';
                    break;
                case 'u':
                case 'x':
                    if (source[index] === '{') {
                        ++index;
                        str += scanUnicodeCodePointEscape();
                    } else {
                        restore = index;
                        unescaped = scanHexEscape(ch);
                        if (unescaped) {
                            str += unescaped;
                        } else {
                            index = restore;
                            str += ch;
                        }
                    }
                    break;
                case 'b':
                    str += '\b';
                    break;
                case 'f':
                    str += '\f';
                    break;
                case 'v':
                    str += '\x0B';
                    break;
                default:
                    if (isOctalDigit(ch)) {
                        code = '01234567'.indexOf(ch);
                        // \0 is not octal escape sequence
                        if (code !== 0) {
                            octal = true;
                        }
                        if (index < length && isOctalDigit(source[index])) {
                            octal = true;
                            code = code * 8 + '01234567'.indexOf(source[index++]);
                            // 3 digits are only allowed when string starts
                            // with 0, 1, 2, 3
                            if ('0123'.indexOf(ch) >= 0 && index < length && isOctalDigit(source[index])) {
                                code = code * 8 + '01234567'.indexOf(source[index++]);
                            }
                        }
                        str += String.fromCharCode(code);
                    } else {
                        str += ch;
                    }
                    break;
                }
            } else {
                ++lineNumber;
                if (ch === '\r' && source[index] === '\n') {
                    ++index;
                }
            }
        } else if (isLineTerminator(ch.charCodeAt(0))) {
            break;
        } else {
            str += ch;
        }
    }
    if (quote !== '') {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    return {
        type: Token.StringLiteral,
        value: str,
        octal: octal,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            start,
            index
        ]
    };
}
function scanTemplate() {
    var cooked = '', ch, start, terminated, tail, restore, unescaped, code, octal;
    terminated = false;
    tail = false;
    start = index;
    ++index;
    while (index < length) {
        ch = source[index++];
        if (ch === '`') {
            tail = true;
            terminated = true;
            break;
        } else if (ch === '$') {
            if (source[index] === '{') {
                ++index;
                terminated = true;
                break;
            }
            cooked += ch;
        } else if (ch === '\\') {
            ch = source[index++];
            if (!isLineTerminator(ch.charCodeAt(0))) {
                switch (ch) {
                case 'n':
                    cooked += '\n';
                    break;
                case 'r':
                    cooked += '\r';
                    break;
                case 't':
                    cooked += '\t';
                    break;
                case 'u':
                case 'x':
                    if (source[index] === '{') {
                        ++index;
                        cooked += scanUnicodeCodePointEscape();
                    } else {
                        restore = index;
                        unescaped = scanHexEscape(ch);
                        if (unescaped) {
                            cooked += unescaped;
                        } else {
                            index = restore;
                            cooked += ch;
                        }
                    }
                    break;
                case 'b':
                    cooked += '\b';
                    break;
                case 'f':
                    cooked += '\f';
                    break;
                case 'v':
                    cooked += '\x0B';
                    break;
                default:
                    if (isOctalDigit(ch)) {
                        code = '01234567'.indexOf(ch);
                        // \0 is not octal escape sequence
                        if (code !== 0) {
                            octal = true;
                        }
                        if (index < length && isOctalDigit(source[index])) {
                            octal = true;
                            code = code * 8 + '01234567'.indexOf(source[index++]);
                            // 3 digits are only allowed when string starts
                            // with 0, 1, 2, 3
                            if ('0123'.indexOf(ch) >= 0 && index < length && isOctalDigit(source[index])) {
                                code = code * 8 + '01234567'.indexOf(source[index++]);
                            }
                        }
                        cooked += String.fromCharCode(code);
                    } else {
                        cooked += ch;
                    }
                    break;
                }
            } else {
                ++lineNumber;
                if (ch === '\r' && source[index] === '\n') {
                    ++index;
                }
            }
        } else if (isLineTerminator(ch.charCodeAt(0))) {
            ++lineNumber;
            if (ch === '\r' && source[index] === '\n') {
                ++index;
            }
            cooked += '\n';
        } else {
            cooked += ch;
        }
    }
    if (!terminated) {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    return {
        type: Token.Template,
        value: {
            cooked: cooked,
            raw: source.slice(start + 1, index - (tail ? 1 : 2))
        },
        tail: tail,
        octal: octal,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            start,
            index
        ]
    };
}
function scanTemplateElement(option) {
    var startsWith, template;
    lookahead = null;
    skipComment();
    startsWith = option.head ? '`' : '}';
    if (source[index] !== startsWith) {
        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }
    template = scanTemplate();
    peek();
    return template;
}
function scanRegExp() {
    var str, ch, start, pattern, flags, value, classMarker = false, restore, terminated = false;
    lookahead = null;
    skipComment();
    start = index;
    ch = source[index];
    assert(ch === '/', 'Regular expression literal must start with a slash');
    str = source[index++];
    while (index < length) {
        ch = source[index++];
        str += ch;
        if (classMarker) {
            if (ch === ']') {
                classMarker = false;
            }
        } else {
            if (ch === '\\') {
                ch = source[index++];
                // ECMA-262 7.8.5
                if (isLineTerminator(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnterminatedRegExp);
                }
                str += ch;
            } else if (ch === '/') {
                terminated = true;
                break;
            } else if (ch === '[') {
                classMarker = true;
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                throwError({}, Messages.UnterminatedRegExp);
            }
        }
    }
    if (!terminated) {
        throwError({}, Messages.UnterminatedRegExp);
    }
    // Exclude leading and trailing slash.
    pattern = str.substr(1, str.length - 2);
    flags = '';
    while (index < length) {
        ch = source[index];
        if (!isIdentifierPart(ch.charCodeAt(0))) {
            break;
        }
        ++index;
        if (ch === '\\' && index < length) {
            ch = source[index];
            if (ch === 'u') {
                ++index;
                restore = index;
                ch = scanHexEscape('u');
                if (ch) {
                    flags += ch;
                    for (str += '\\u'; restore < index; ++restore) {
                        str += source[restore];
                    }
                } else {
                    index = restore;
                    flags += 'u';
                    str += '\\u';
                }
            } else {
                str += '\\';
            }
        } else {
            flags += ch;
            str += ch;
        }
    }
    try {
        value = new RegExp(pattern, flags);
    } catch (e) {
        throwError({}, Messages.InvalidRegExp);
    }
    // peek();
    if (extra.tokenize) {
        return {
            type: Token.RegularExpression,
            value: value,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                start,
                index
            ]
        };
    }
    return {
        type: Token.RegularExpression,
        literal: str,
        value: value,
        range: [
            start,
            index
        ]
    };
}
function isIdentifierName(token) {
    return token.type === Token.Identifier || token.type === Token.Keyword || token.type === Token.BooleanLiteral || token.type === Token.NullLiteral;
}
function advanceSlash() {
    var prevToken, checkToken;
    // Using the following algorithm:
    // https://github.com/mozilla/sweet.js/wiki/design
    prevToken = extra.tokens[extra.tokens.length - 1];
    if (!prevToken) {
        // Nothing before that: it cannot be a division.
        return scanRegExp();
    }
    if (prevToken.type === 'Punctuator') {
        if (prevToken.value === ')') {
            checkToken = extra.tokens[extra.openParenToken - 1];
            if (checkToken && checkToken.type === 'Keyword' && (checkToken.value === 'if' || checkToken.value === 'while' || checkToken.value === 'for' || checkToken.value === 'with')) {
                return scanRegExp();
            }
            return scanPunctuator();
        }
        if (prevToken.value === '}') {
            // Dividing a function by anything makes little sense,
            // but we have to check for that.
            if (extra.tokens[extra.openCurlyToken - 3] && extra.tokens[extra.openCurlyToken - 3].type === 'Keyword') {
                // Anonymous function.
                checkToken = extra.tokens[extra.openCurlyToken - 4];
                if (!checkToken) {
                    return scanPunctuator();
                }
            } else if (extra.tokens[extra.openCurlyToken - 4] && extra.tokens[extra.openCurlyToken - 4].type === 'Keyword') {
                // Named function.
                checkToken = extra.tokens[extra.openCurlyToken - 5];
                if (!checkToken) {
                    return scanRegExp();
                }
            } else {
                return scanPunctuator();
            }
            // checkToken determines whether the function is
            // a declaration or an expression.
            if (FnExprTokens.indexOf(checkToken.value) >= 0) {
                // It is an expression.
                return scanPunctuator();
            }
            // It is a declaration.
            return scanRegExp();
        }
        return scanRegExp();
    }
    if (prevToken.type === 'Keyword') {
        return scanRegExp();
    }
    return scanPunctuator();
}
function advance() {
    var ch;
    skipComment();
    if (index >= length) {
        return {
            type: Token.EOF,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                index,
                index
            ]
        };
    }
    ch = source.charCodeAt(index);
    // Very common: ( and ) and ;
    if (ch === 40 || ch === 41 || ch === 58) {
        return scanPunctuator();
    }
    // String literal starts with single quote (#39) or double quote (#34).
    if (ch === 39 || ch === 34) {
        return scanStringLiteral();
    }
    if (ch === 96) {
        return scanTemplate();
    }
    if (isIdentifierStart(ch)) {
        return scanIdentifier();
    }
    // # and @ are allowed for sweet.js
    if (ch === 35 || ch === 64) {
        ++index;
        return {
            type: Token.Punctuator,
            value: String.fromCharCode(ch),
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                index - 1,
                index
            ]
        };
    }
    // Dot (.) char #46 can also start a floating-point number, hence the need
    // to check the next character.
    if (ch === 46) {
        if (isDecimalDigit(source.charCodeAt(index + 1))) {
            return scanNumericLiteral();
        }
        return scanPunctuator();
    }
    if (isDecimalDigit(ch)) {
        return scanNumericLiteral();
    }
    // Slash (/) char #47 can also start a regex.
    if (extra.tokenize && ch === 47) {
        return advanceSlash();
    }
    return scanPunctuator();
}
function lex() {
    var token;
    token = lookahead;
    streamIndex = lookaheadIndex;
    lineNumber = token.lineNumber;
    lineStart = token.lineStart;
    sm_lineNumber = lookahead.sm_lineNumber;
    sm_lineStart = lookahead.sm_lineStart;
    sm_range = lookahead.sm_range;
    sm_index = lookahead.sm_range[0];
    lookahead = tokenStream[++streamIndex].token;
    lookaheadIndex = streamIndex;
    index = lookahead.range[0];
    return token;
}
function peek() {
    lookaheadIndex = streamIndex + 1;
    if (lookaheadIndex >= length) {
        lookahead = {
            type: Token.EOF,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                index,
                index
            ]
        };
        return;
    }
    lookahead = tokenStream[lookaheadIndex].token;
    index = lookahead.range[0];
}
function lookahead2() {
    var adv, pos, line, start, result;
    if (streamIndex + 1 >= length || streamIndex + 2 >= length) {
        return {
            type: Token.EOF,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                index,
                index
            ]
        };
    }
    // Scan for the next immediate token.
    if (lookahead === null) {
        lookaheadIndex = streamIndex + 1;
        lookahead = tokenStream[lookaheadIndex].token;
        index = lookahead.range[0];
    }
    result = tokenStream[lookaheadIndex + 1].token;
    return result;
}
SyntaxTreeDelegate = {
    name: 'SyntaxTree',
    postProcess: function (node) {
        return node;
    },
    createArrayExpression: function (elements) {
        return {
            type: Syntax.ArrayExpression,
            elements: elements
        };
    },
    createAssignmentExpression: function (operator, left, right) {
        return {
            type: Syntax.AssignmentExpression,
            operator: operator,
            left: left,
            right: right
        };
    },
    createBinaryExpression: function (operator, left, right) {
        var type = operator === '||' || operator === '&&' ? Syntax.LogicalExpression : Syntax.BinaryExpression;
        return {
            type: type,
            operator: operator,
            left: left,
            right: right
        };
    },
    createBlockStatement: function (body) {
        return {
            type: Syntax.BlockStatement,
            body: body
        };
    },
    createBreakStatement: function (label) {
        return {
            type: Syntax.BreakStatement,
            label: label
        };
    },
    createCallExpression: function (callee, args) {
        return {
            type: Syntax.CallExpression,
            callee: callee,
            'arguments': args
        };
    },
    createCatchClause: function (param, body) {
        return {
            type: Syntax.CatchClause,
            param: param,
            body: body
        };
    },
    createConditionalExpression: function (test, consequent, alternate) {
        return {
            type: Syntax.ConditionalExpression,
            test: test,
            consequent: consequent,
            alternate: alternate
        };
    },
    createContinueStatement: function (label) {
        return {
            type: Syntax.ContinueStatement,
            label: label
        };
    },
    createDebuggerStatement: function () {
        return { type: Syntax.DebuggerStatement };
    },
    createDoWhileStatement: function (body, test) {
        return {
            type: Syntax.DoWhileStatement,
            body: body,
            test: test
        };
    },
    createEmptyStatement: function () {
        return { type: Syntax.EmptyStatement };
    },
    createExpressionStatement: function (expression) {
        return {
            type: Syntax.ExpressionStatement,
            expression: expression
        };
    },
    createForStatement: function (init, test, update, body) {
        return {
            type: Syntax.ForStatement,
            init: init,
            test: test,
            update: update,
            body: body
        };
    },
    createForInStatement: function (left, right, body) {
        return {
            type: Syntax.ForInStatement,
            left: left,
            right: right,
            body: body,
            each: false
        };
    },
    createForOfStatement: function (left, right, body) {
        return {
            type: Syntax.ForOfStatement,
            left: left,
            right: right,
            body: body
        };
    },
    createFunctionDeclaration: function (id, params, defaults, body, rest, generator, expression) {
        return {
            type: Syntax.FunctionDeclaration,
            id: id,
            params: params,
            defaults: defaults,
            body: body,
            rest: rest,
            generator: generator,
            expression: expression
        };
    },
    createFunctionExpression: function (id, params, defaults, body, rest, generator, expression) {
        return {
            type: Syntax.FunctionExpression,
            id: id,
            params: params,
            defaults: defaults,
            body: body,
            rest: rest,
            generator: generator,
            expression: expression
        };
    },
    createIdentifier: function (name) {
        return {
            type: Syntax.Identifier,
            name: name
        };
    },
    createIfStatement: function (test, consequent, alternate) {
        return {
            type: Syntax.IfStatement,
            test: test,
            consequent: consequent,
            alternate: alternate
        };
    },
    createLabeledStatement: function (label, body) {
        return {
            type: Syntax.LabeledStatement,
            label: label,
            body: body
        };
    },
    createLiteral: function (token) {
        return {
            type: Syntax.Literal,
            value: token.value,
            raw: String(token.value)
        };
    },
    createMemberExpression: function (accessor, object, property) {
        return {
            type: Syntax.MemberExpression,
            computed: accessor === '[',
            object: object,
            property: property
        };
    },
    createNewExpression: function (callee, args) {
        return {
            type: Syntax.NewExpression,
            callee: callee,
            'arguments': args
        };
    },
    createObjectExpression: function (properties) {
        return {
            type: Syntax.ObjectExpression,
            properties: properties
        };
    },
    createPostfixExpression: function (operator, argument) {
        return {
            type: Syntax.UpdateExpression,
            operator: operator,
            argument: argument,
            prefix: false
        };
    },
    createProgram: function (body) {
        return {
            type: Syntax.Program,
            body: body
        };
    },
    createProperty: function (kind, key, value, method, shorthand) {
        return {
            type: Syntax.Property,
            key: key,
            value: value,
            kind: kind,
            method: method,
            shorthand: shorthand
        };
    },
    createReturnStatement: function (argument) {
        return {
            type: Syntax.ReturnStatement,
            argument: argument
        };
    },
    createSequenceExpression: function (expressions) {
        return {
            type: Syntax.SequenceExpression,
            expressions: expressions
        };
    },
    createSwitchCase: function (test, consequent) {
        return {
            type: Syntax.SwitchCase,
            test: test,
            consequent: consequent
        };
    },
    createSwitchStatement: function (discriminant, cases) {
        return {
            type: Syntax.SwitchStatement,
            discriminant: discriminant,
            cases: cases
        };
    },
    createThisExpression: function () {
        return { type: Syntax.ThisExpression };
    },
    createThrowStatement: function (argument) {
        return {
            type: Syntax.ThrowStatement,
            argument: argument
        };
    },
    createTryStatement: function (block, guardedHandlers, handlers, finalizer) {
        return {
            type: Syntax.TryStatement,
            block: block,
            guardedHandlers: guardedHandlers,
            handlers: handlers,
            finalizer: finalizer
        };
    },
    createUnaryExpression: function (operator, argument) {
        if (operator === '++' || operator === '--') {
            return {
                type: Syntax.UpdateExpression,
                operator: operator,
                argument: argument,
                prefix: true
            };
        }
        return {
            type: Syntax.UnaryExpression,
            operator: operator,
            argument: argument
        };
    },
    createVariableDeclaration: function (declarations, kind) {
        return {
            type: Syntax.VariableDeclaration,
            declarations: declarations,
            kind: kind
        };
    },
    createVariableDeclarator: function (id, init) {
        return {
            type: Syntax.VariableDeclarator,
            id: id,
            init: init
        };
    },
    createWhileStatement: function (test, body) {
        return {
            type: Syntax.WhileStatement,
            test: test,
            body: body
        };
    },
    createWithStatement: function (object, body) {
        return {
            type: Syntax.WithStatement,
            object: object,
            body: body
        };
    },
    createTemplateElement: function (value, tail) {
        return {
            type: Syntax.TemplateElement,
            value: value,
            tail: tail
        };
    },
    createTemplateLiteral: function (quasis, expressions) {
        return {
            type: Syntax.TemplateLiteral,
            quasis: quasis,
            expressions: expressions
        };
    },
    createSpreadElement: function (argument) {
        return {
            type: Syntax.SpreadElement,
            argument: argument
        };
    },
    createTaggedTemplateExpression: function (tag, quasi) {
        return {
            type: Syntax.TaggedTemplateExpression,
            tag: tag,
            quasi: quasi
        };
    },
    createArrowFunctionExpression: function (params, defaults, body, rest, expression) {
        return {
            type: Syntax.ArrowFunctionExpression,
            id: null,
            params: params,
            defaults: defaults,
            body: body,
            rest: rest,
            generator: false,
            expression: expression
        };
    },
    createMethodDefinition: function (propertyType, kind, key, value) {
        return {
            type: Syntax.MethodDefinition,
            key: key,
            value: value,
            kind: kind,
            'static': propertyType === ClassPropertyType.static
        };
    },
    createClassBody: function (body) {
        return {
            type: Syntax.ClassBody,
            body: body
        };
    },
    createClassExpression: function (id, superClass, body) {
        return {
            type: Syntax.ClassExpression,
            id: id,
            superClass: superClass,
            body: body
        };
    },
    createClassDeclaration: function (id, superClass, body) {
        return {
            type: Syntax.ClassDeclaration,
            id: id,
            superClass: superClass,
            body: body
        };
    },
    createExportSpecifier: function (id, name) {
        return {
            type: Syntax.ExportSpecifier,
            id: id,
            name: name
        };
    },
    createExportBatchSpecifier: function () {
        return { type: Syntax.ExportBatchSpecifier };
    },
    createExportDeclaration: function (declaration, specifiers, source$2) {
        return {
            type: Syntax.ExportDeclaration,
            declaration: declaration,
            specifiers: specifiers,
            source: source$2
        };
    },
    createImportSpecifier: function (id, name) {
        return {
            type: Syntax.ImportSpecifier,
            id: id,
            name: name
        };
    },
    createImportDeclaration: function (specifiers, kind, source$2) {
        return {
            type: Syntax.ImportDeclaration,
            specifiers: specifiers,
            kind: kind,
            source: source$2
        };
    },
    createYieldExpression: function (argument, delegate$2) {
        return {
            type: Syntax.YieldExpression,
            argument: argument,
            delegate: delegate$2
        };
    },
    createModuleDeclaration: function (id, source$2, body) {
        return {
            type: Syntax.ModuleDeclaration,
            id: id,
            source: source$2,
            body: body
        };
    }
};
// Return true if there is a line terminator before the next token.
function peekLineTerminator() {
    return lookahead.lineNumber !== lineNumber;
}
// Throw an exception
function throwError(token, messageFormat) {
    var error, args = Array.prototype.slice.call(arguments, 2), msg = messageFormat.replace(/%(\d)/g, function (whole, index$2) {
            assert(index$2 < args.length, 'Message reference must be in range');
            return args[index$2];
        });
    var startIndex = streamIndex > 3 ? streamIndex - 3 : 0;
    var toks = '', tailingMsg = '';
    if (tokenStream) {
        toks = tokenStream.slice(startIndex, streamIndex + 3).map(function (stx) {
            return stx.token.value;
        }).join(' ');
        tailingMsg = '\n[... ' + toks + ' ...]';
    }
    if (typeof token.lineNumber === 'number') {
        error = new Error('Line ' + token.lineNumber + ': ' + msg + tailingMsg);
        error.index = token.range[0];
        error.lineNumber = token.lineNumber;
        error.column = token.range[0] - lineStart + 1;
    } else {
        error = new Error('Line ' + lineNumber + ': ' + msg + tailingMsg);
        error.index = index;
        error.lineNumber = lineNumber;
        error.column = index - lineStart + 1;
    }
    error.description = msg;
    throw error;
}
function throwErrorTolerant() {
    try {
        throwError.apply(null, arguments);
    } catch (e) {
        if (extra.errors) {
            extra.errors.push(e);
        } else {
            throw e;
        }
    }
}
// Throw an exception because of the token.
function throwUnexpected(token) {
    if (token.type === Token.EOF) {
        throwError(token, Messages.UnexpectedEOS);
    }
    if (token.type === Token.NumericLiteral) {
        throwError(token, Messages.UnexpectedNumber);
    }
    if (token.type === Token.StringLiteral) {
        throwError(token, Messages.UnexpectedString);
    }
    if (token.type === Token.Identifier) {
        throwError(token, Messages.UnexpectedIdentifier);
    }
    if (token.type === Token.Keyword) {
        if (isFutureReservedWord(token.value)) {
        }    // sweet.js allows future reserved words
             // throwError(token, Messages.UnexpectedReserved);
        else if (strict && isStrictModeReservedWord(token.value)) {
            throwErrorTolerant(token, Messages.StrictReservedWord);
            return;
        }
        throwError(token, Messages.UnexpectedToken, token.value);
    }
    if (token.type === Token.Template) {
        throwError(token, Messages.UnexpectedTemplate, token.value.raw);
    }
    // BooleanLiteral, NullLiteral, or Punctuator.
    throwError(token, Messages.UnexpectedToken, token.value);
}
// Expect the next token to match the specified punctuator.
// If not, an exception will be thrown.
function expect(value) {
    var token = lex();
    if (token.type !== Token.Punctuator || token.value !== value) {
        throwUnexpected(token);
    }
}
// Expect the next token to match the specified keyword.
// If not, an exception will be thrown.
function expectKeyword(keyword) {
    var token = lex();
    if (token.type !== Token.Keyword || token.value !== keyword) {
        throwUnexpected(token);
    }
}
// Return true if the next token matches the specified punctuator.
function match(value) {
    return lookahead.type === Token.Punctuator && lookahead.value === value;
}
// Return true if the next token matches the specified keyword
function matchKeyword(keyword) {
    return lookahead.type === Token.Keyword && lookahead.value === keyword;
}
// Return true if the next token matches the specified contextual keyword
function matchContextualKeyword(keyword) {
    return lookahead.type === Token.Identifier && lookahead.value === keyword;
}
// Return true if the next token is an assignment operator
function matchAssign() {
    var op;
    if (lookahead.type !== Token.Punctuator) {
        return false;
    }
    op = lookahead.value;
    return op === '=' || op === '*=' || op === '/=' || op === '%=' || op === '+=' || op === '-=' || op === '<<=' || op === '>>=' || op === '>>>=' || op === '&=' || op === '^=' || op === '|=';
}
function consumeSemicolon() {
    var line, ch;
    ch = lookahead.value ? String(lookahead.value).charCodeAt(0) : -1;
    // Catch the very common case first: immediately a semicolon (char #59).
    if (ch === 59) {
        lex();
        return;
    }
    if (lookahead.lineNumber !== lineNumber) {
        return;
    }
    if (match(';')) {
        lex();
        return;
    }
    if (lookahead.type !== Token.EOF && !match('}')) {
        throwUnexpected(lookahead);
    }
}
// Return true if provided expression is LeftHandSideExpression
function isLeftHandSide(expr) {
    return expr.type === Syntax.Identifier || expr.type === Syntax.MemberExpression;
}
function isAssignableLeftHandSide(expr) {
    return isLeftHandSide(expr) || expr.type === Syntax.ObjectPattern || expr.type === Syntax.ArrayPattern;
}
// 11.1.4 Array Initialiser
function parseArrayInitialiser() {
    var elements = [], blocks = [], filter = null, tmp, possiblecomprehension = true, body;
    expect('[');
    while (!match(']')) {
        if (lookahead.value === 'for' && lookahead.type === Token.Keyword) {
            if (!possiblecomprehension) {
                throwError({}, Messages.ComprehensionError);
            }
            matchKeyword('for');
            tmp = parseForStatement({ ignoreBody: true });
            tmp.of = tmp.type === Syntax.ForOfStatement;
            tmp.type = Syntax.ComprehensionBlock;
            if (tmp.left.kind) {
                // can't be let or const
                throwError({}, Messages.ComprehensionError);
            }
            blocks.push(tmp);
        } else if (lookahead.value === 'if' && lookahead.type === Token.Keyword) {
            if (!possiblecomprehension) {
                throwError({}, Messages.ComprehensionError);
            }
            expectKeyword('if');
            expect('(');
            filter = parseExpression();
            expect(')');
        } else if (lookahead.value === ',' && lookahead.type === Token.Punctuator) {
            possiblecomprehension = false;
            // no longer allowed.
            lex();
            elements.push(null);
        } else {
            tmp = parseSpreadOrAssignmentExpression();
            elements.push(tmp);
            if (tmp && tmp.type === Syntax.SpreadElement) {
                if (!match(']')) {
                    throwError({}, Messages.ElementAfterSpreadElement);
                }
            } else if (!(match(']') || matchKeyword('for') || matchKeyword('if'))) {
                expect(',');
                // this lexes.
                possiblecomprehension = false;
            }
        }
    }
    expect(']');
    if (filter && !blocks.length) {
        throwError({}, Messages.ComprehensionRequiresBlock);
    }
    if (blocks.length) {
        if (elements.length !== 1) {
            throwError({}, Messages.ComprehensionError);
        }
        return {
            type: Syntax.ComprehensionExpression,
            filter: filter,
            blocks: blocks,
            body: elements[0]
        };
    }
    return delegate.createArrayExpression(elements);
}
// 11.1.5 Object Initialiser
function parsePropertyFunction(options) {
    var previousStrict, previousYieldAllowed, params, defaults, body;
    previousStrict = strict;
    previousYieldAllowed = state.yieldAllowed;
    state.yieldAllowed = options.generator;
    params = options.params || [];
    defaults = options.defaults || [];
    body = parseConciseBody();
    if (options.name && strict && isRestrictedWord(params[0].name)) {
        throwErrorTolerant(options.name, Messages.StrictParamName);
    }
    if (state.yieldAllowed && !state.yieldFound) {
        throwErrorTolerant({}, Messages.NoYieldInGenerator);
    }
    strict = previousStrict;
    state.yieldAllowed = previousYieldAllowed;
    return delegate.createFunctionExpression(null, params, defaults, body, options.rest || null, options.generator, body.type !== Syntax.BlockStatement);
}
function parsePropertyMethodFunction(options) {
    var previousStrict, tmp, method;
    previousStrict = strict;
    strict = true;
    tmp = parseParams();
    if (tmp.stricted) {
        throwErrorTolerant(tmp.stricted, tmp.message);
    }
    method = parsePropertyFunction({
        params: tmp.params,
        defaults: tmp.defaults,
        rest: tmp.rest,
        generator: options.generator
    });
    strict = previousStrict;
    return method;
}
function parseObjectPropertyKey() {
    var token = lex();
    // Note: This function is called only from parseObjectProperty(), where
    // EOF and Punctuator tokens are already filtered out.
    if (token.type === Token.StringLiteral || token.type === Token.NumericLiteral) {
        if (strict && token.octal) {
            throwErrorTolerant(token, Messages.StrictOctalLiteral);
        }
        return delegate.createLiteral(token);
    }
    // SWEET.JS: object keys are not resolved
    return delegate.createIdentifier(token.value);
}
function parseObjectProperty() {
    var token, key, id, value, param;
    token = lookahead;
    if (token.type === Token.Identifier) {
        id = parseObjectPropertyKey();
        // Property Assignment: Getter and Setter.
        if (token.value === 'get' && !(match(':') || match('('))) {
            key = parseObjectPropertyKey();
            expect('(');
            expect(')');
            return delegate.createProperty('get', key, parsePropertyFunction({ generator: false }), false, false);
        }
        if (token.value === 'set' && !(match(':') || match('('))) {
            key = parseObjectPropertyKey();
            expect('(');
            token = lookahead;
            param = [parseVariableIdentifier()];
            expect(')');
            return delegate.createProperty('set', key, parsePropertyFunction({
                params: param,
                generator: false,
                name: token
            }), false, false);
        }
        if (match(':')) {
            lex();
            return delegate.createProperty('init', id, parseAssignmentExpression(), false, false);
        }
        if (match('(')) {
            return delegate.createProperty('init', id, parsePropertyMethodFunction({ generator: false }), true, false);
        }
        return delegate.createProperty('init', id, id, false, true);
    }
    if (token.type === Token.EOF || token.type === Token.Punctuator) {
        if (!match('*')) {
            throwUnexpected(token);
        }
        lex();
        id = parseObjectPropertyKey();
        if (!match('(')) {
            throwUnexpected(lex());
        }
        return delegate.createProperty('init', id, parsePropertyMethodFunction({ generator: true }), true, false);
    }
    key = parseObjectPropertyKey();
    if (match(':')) {
        lex();
        return delegate.createProperty('init', key, parseAssignmentExpression(), false, false);
    }
    if (match('(')) {
        return delegate.createProperty('init', key, parsePropertyMethodFunction({ generator: false }), true, false);
    }
    throwUnexpected(lex());
}
function parseObjectInitialiser() {
    var properties = [], property, name, key, kind, map = {}, toString = String;
    expect('{');
    while (!match('}')) {
        property = parseObjectProperty();
        if (property.key.type === Syntax.Identifier) {
            name = property.key.name;
        } else {
            name = toString(property.key.value);
        }
        kind = property.kind === 'init' ? PropertyKind.Data : property.kind === 'get' ? PropertyKind.Get : PropertyKind.Set;
        key = '$' + name;
        if (Object.prototype.hasOwnProperty.call(map, key)) {
            if (map[key] === PropertyKind.Data) {
                if (strict && kind === PropertyKind.Data) {
                    throwErrorTolerant({}, Messages.StrictDuplicateProperty);
                } else if (kind !== PropertyKind.Data) {
                    throwErrorTolerant({}, Messages.AccessorDataProperty);
                }
            } else {
                if (kind === PropertyKind.Data) {
                    throwErrorTolerant({}, Messages.AccessorDataProperty);
                } else if (map[key] & kind) {
                    throwErrorTolerant({}, Messages.AccessorGetSet);
                }
            }
            map[key] |= kind;
        } else {
            map[key] = kind;
        }
        properties.push(property);
        if (!match('}')) {
            expect(',');
        }
    }
    expect('}');
    return delegate.createObjectExpression(properties);
}
function parseTemplateElement(option) {
    var token = lex();
    if (strict && token.octal) {
        throwError(token, Messages.StrictOctalLiteral);
    }
    return delegate.createTemplateElement({
        raw: token.value.raw,
        cooked: token.value.cooked
    }, token.tail);
}
function parseTemplateLiteral() {
    var quasi, quasis, expressions;
    quasi = parseTemplateElement({ head: true });
    quasis = [quasi];
    expressions = [];
    while (!quasi.tail) {
        expressions.push(parseExpression());
        quasi = parseTemplateElement({ head: false });
        quasis.push(quasi);
    }
    return delegate.createTemplateLiteral(quasis, expressions);
}
// 11.1.6 The Grouping Operator
function parseGroupExpression() {
    var expr;
    expect('(');
    ++state.parenthesizedCount;
    expr = parseExpression();
    expect(')');
    return expr;
}
// 11.1 Primary Expressions
function parsePrimaryExpression() {
    var type, token, resolvedIdent;
    token = lookahead;
    type = lookahead.type;
    if (type === Token.Identifier) {
        resolvedIdent = expander.resolve(tokenStream[lookaheadIndex]);
        lex();
        return delegate.createIdentifier(resolvedIdent);
    }
    if (type === Token.StringLiteral || type === Token.NumericLiteral) {
        if (strict && lookahead.octal) {
            throwErrorTolerant(lookahead, Messages.StrictOctalLiteral);
        }
        return delegate.createLiteral(lex());
    }
    if (type === Token.Keyword) {
        if (matchKeyword('this')) {
            lex();
            return delegate.createThisExpression();
        }
        if (matchKeyword('function')) {
            return parseFunctionExpression();
        }
        if (matchKeyword('class')) {
            return parseClassExpression();
        }
        if (matchKeyword('super')) {
            lex();
            return delegate.createIdentifier('super');
        }
    }
    if (type === Token.BooleanLiteral) {
        token = lex();
        token.value = token.value === 'true';
        return delegate.createLiteral(token);
    }
    if (type === Token.NullLiteral) {
        token = lex();
        token.value = null;
        return delegate.createLiteral(token);
    }
    if (match('[')) {
        return parseArrayInitialiser();
    }
    if (match('{')) {
        return parseObjectInitialiser();
    }
    if (match('(')) {
        return parseGroupExpression();
    }
    if (lookahead.type === Token.RegularExpression) {
        return delegate.createLiteral(lex());
    }
    if (type === Token.Template) {
        return parseTemplateLiteral();
    }
    return throwUnexpected(lex());
}
// 11.2 Left-Hand-Side Expressions
function parseArguments() {
    var args = [], arg;
    expect('(');
    if (!match(')')) {
        while (streamIndex < length) {
            arg = parseSpreadOrAssignmentExpression();
            args.push(arg);
            if (match(')')) {
                break;
            } else if (arg.type === Syntax.SpreadElement) {
                throwError({}, Messages.ElementAfterSpreadElement);
            }
            expect(',');
        }
    }
    expect(')');
    return args;
}
function parseSpreadOrAssignmentExpression() {
    if (match('...')) {
        lex();
        return delegate.createSpreadElement(parseAssignmentExpression());
    }
    return parseAssignmentExpression();
}
function parseNonComputedProperty() {
    var token = lex();
    if (!isIdentifierName(token)) {
        throwUnexpected(token);
    }
    return delegate.createIdentifier(token.value);
}
function parseNonComputedMember() {
    expect('.');
    return parseNonComputedProperty();
}
function parseComputedMember() {
    var expr;
    expect('[');
    expr = parseExpression();
    expect(']');
    return expr;
}
function parseNewExpression() {
    var callee, args;
    expectKeyword('new');
    callee = parseLeftHandSideExpression();
    args = match('(') ? parseArguments() : [];
    return delegate.createNewExpression(callee, args);
}
function parseLeftHandSideExpressionAllowCall() {
    var expr, args, property;
    expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();
    while (match('.') || match('[') || match('(') || lookahead.type === Token.Template) {
        if (match('(')) {
            args = parseArguments();
            expr = delegate.createCallExpression(expr, args);
        } else if (match('[')) {
            expr = delegate.createMemberExpression('[', expr, parseComputedMember());
        } else if (match('.')) {
            expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
        } else {
            expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
        }
    }
    return expr;
}
function parseLeftHandSideExpression() {
    var expr, property;
    expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();
    while (match('.') || match('[') || lookahead.type === Token.Template) {
        if (match('[')) {
            expr = delegate.createMemberExpression('[', expr, parseComputedMember());
        } else if (match('.')) {
            expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
        } else {
            expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
        }
    }
    return expr;
}
// 11.3 Postfix Expressions
function parsePostfixExpression() {
    var expr = parseLeftHandSideExpressionAllowCall(), token = lookahead;
    if (lookahead.type !== Token.Punctuator) {
        return expr;
    }
    if ((match('++') || match('--')) && !peekLineTerminator()) {
        // 11.3.1, 11.3.2
        if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
            throwErrorTolerant({}, Messages.StrictLHSPostfix);
        }
        if (!isLeftHandSide(expr)) {
            throwError({}, Messages.InvalidLHSInAssignment);
        }
        token = lex();
        expr = delegate.createPostfixExpression(token.value, expr);
    }
    return expr;
}
// 11.4 Unary Operators
function parseUnaryExpression() {
    var token, expr;
    if (lookahead.type !== Token.Punctuator && lookahead.type !== Token.Keyword) {
        return parsePostfixExpression();
    }
    if (match('++') || match('--')) {
        token = lex();
        expr = parseUnaryExpression();
        // 11.4.4, 11.4.5
        if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
            throwErrorTolerant({}, Messages.StrictLHSPrefix);
        }
        if (!isLeftHandSide(expr)) {
            throwError({}, Messages.InvalidLHSInAssignment);
        }
        return delegate.createUnaryExpression(token.value, expr);
    }
    if (match('+') || match('-') || match('~') || match('!')) {
        token = lex();
        expr = parseUnaryExpression();
        return delegate.createUnaryExpression(token.value, expr);
    }
    if (matchKeyword('delete') || matchKeyword('void') || matchKeyword('typeof')) {
        token = lex();
        expr = parseUnaryExpression();
        expr = delegate.createUnaryExpression(token.value, expr);
        if (expr.operator === 'delete' && expr.argument.type === Syntax.Identifier) {
            throwErrorTolerant({}, Messages.StrictDelete);
        }
        return expr;
    }
    return parsePostfixExpression();
}
function binaryPrecedence(token, allowIn) {
    var prec = 0;
    if (token.type !== Token.Punctuator && token.type !== Token.Keyword) {
        return 0;
    }
    switch (token.value) {
    case '||':
        prec = 1;
        break;
    case '&&':
        prec = 2;
        break;
    case '|':
        prec = 3;
        break;
    case '^':
        prec = 4;
        break;
    case '&':
        prec = 5;
        break;
    case '==':
    case '!=':
    case '===':
    case '!==':
        prec = 6;
        break;
    case '<':
    case '>':
    case '<=':
    case '>=':
    case 'instanceof':
        prec = 7;
        break;
    case 'in':
        prec = allowIn ? 7 : 0;
        break;
    case '<<':
    case '>>':
    case '>>>':
        prec = 8;
        break;
    case '+':
    case '-':
        prec = 9;
        break;
    case '*':
    case '/':
    case '%':
        prec = 11;
        break;
    default:
        break;
    }
    return prec;
}
// 11.5 Multiplicative Operators
// 11.6 Additive Operators
// 11.7 Bitwise Shift Operators
// 11.8 Relational Operators
// 11.9 Equality Operators
// 11.10 Binary Bitwise Operators
// 11.11 Binary Logical Operators
function parseBinaryExpression() {
    var expr, token, prec, previousAllowIn, stack, right, operator, left, i;
    previousAllowIn = state.allowIn;
    state.allowIn = true;
    expr = parseUnaryExpression();
    token = lookahead;
    prec = binaryPrecedence(token, previousAllowIn);
    if (prec === 0) {
        return expr;
    }
    token.prec = prec;
    lex();
    stack = [
        expr,
        token,
        parseUnaryExpression()
    ];
    while ((prec = binaryPrecedence(lookahead, previousAllowIn)) > 0) {
        // Reduce: make a binary expression from the three topmost entries.
        while (stack.length > 2 && prec <= stack[stack.length - 2].prec) {
            right = stack.pop();
            operator = stack.pop().value;
            left = stack.pop();
            stack.push(delegate.createBinaryExpression(operator, left, right));
        }
        // Shift.
        token = lex();
        token.prec = prec;
        stack.push(token);
        stack.push(parseUnaryExpression());
    }
    state.allowIn = previousAllowIn;
    // Final reduce to clean-up the stack.
    i = stack.length - 1;
    expr = stack[i];
    while (i > 1) {
        expr = delegate.createBinaryExpression(stack[i - 1].value, stack[i - 2], expr);
        i -= 2;
    }
    return expr;
}
// 11.12 Conditional Operator
function parseConditionalExpression() {
    var expr, previousAllowIn, consequent, alternate;
    expr = parseBinaryExpression();
    if (match('?')) {
        lex();
        previousAllowIn = state.allowIn;
        state.allowIn = true;
        consequent = parseAssignmentExpression();
        state.allowIn = previousAllowIn;
        expect(':');
        alternate = parseAssignmentExpression();
        expr = delegate.createConditionalExpression(expr, consequent, alternate);
    }
    return expr;
}
// 11.13 Assignment Operators
function reinterpretAsAssignmentBindingPattern(expr) {
    var i, len, property, element;
    if (expr.type === Syntax.ObjectExpression) {
        expr.type = Syntax.ObjectPattern;
        for (i = 0, len = expr.properties.length; i < len; i += 1) {
            property = expr.properties[i];
            if (property.kind !== 'init') {
                throwError({}, Messages.InvalidLHSInAssignment);
            }
            reinterpretAsAssignmentBindingPattern(property.value);
        }
    } else if (expr.type === Syntax.ArrayExpression) {
        expr.type = Syntax.ArrayPattern;
        for (i = 0, len = expr.elements.length; i < len; i += 1) {
            element = expr.elements[i];
            if (element) {
                reinterpretAsAssignmentBindingPattern(element);
            }
        }
    } else if (expr.type === Syntax.Identifier) {
        if (isRestrictedWord(expr.name)) {
            throwError({}, Messages.InvalidLHSInAssignment);
        }
    } else if (expr.type === Syntax.SpreadElement) {
        reinterpretAsAssignmentBindingPattern(expr.argument);
        if (expr.argument.type === Syntax.ObjectPattern) {
            throwError({}, Messages.ObjectPatternAsSpread);
        }
    } else {
        if (expr.type !== Syntax.MemberExpression && expr.type !== Syntax.CallExpression && expr.type !== Syntax.NewExpression) {
            throwError({}, Messages.InvalidLHSInAssignment);
        }
    }
}
function reinterpretAsDestructuredParameter(options, expr) {
    var i, len, property, element;
    if (expr.type === Syntax.ObjectExpression) {
        expr.type = Syntax.ObjectPattern;
        for (i = 0, len = expr.properties.length; i < len; i += 1) {
            property = expr.properties[i];
            if (property.kind !== 'init') {
                throwError({}, Messages.InvalidLHSInFormalsList);
            }
            reinterpretAsDestructuredParameter(options, property.value);
        }
    } else if (expr.type === Syntax.ArrayExpression) {
        expr.type = Syntax.ArrayPattern;
        for (i = 0, len = expr.elements.length; i < len; i += 1) {
            element = expr.elements[i];
            if (element) {
                reinterpretAsDestructuredParameter(options, element);
            }
        }
    } else if (expr.type === Syntax.Identifier) {
        validateParam(options, expr, expr.name);
    } else {
        if (expr.type !== Syntax.MemberExpression) {
            throwError({}, Messages.InvalidLHSInFormalsList);
        }
    }
}
function reinterpretAsCoverFormalsList(expressions) {
    var i, len, param, params, defaults, defaultCount, options, rest;
    params = [];
    defaults = [];
    defaultCount = 0;
    rest = null;
    options = { paramSet: {} };
    for (i = 0, len = expressions.length; i < len; i += 1) {
        param = expressions[i];
        if (param.type === Syntax.Identifier) {
            params.push(param);
            defaults.push(null);
            validateParam(options, param, param.name);
        } else if (param.type === Syntax.ObjectExpression || param.type === Syntax.ArrayExpression) {
            reinterpretAsDestructuredParameter(options, param);
            params.push(param);
            defaults.push(null);
        } else if (param.type === Syntax.SpreadElement) {
            assert(i === len - 1, 'It is guaranteed that SpreadElement is last element by parseExpression');
            reinterpretAsDestructuredParameter(options, param.argument);
            rest = param.argument;
        } else if (param.type === Syntax.AssignmentExpression) {
            params.push(param.left);
            defaults.push(param.right);
            ++defaultCount;
            validateParam(options, param.left, param.left.name);
        } else {
            return null;
        }
    }
    if (options.message === Messages.StrictParamDupe) {
        throwError(strict ? options.stricted : options.firstRestricted, options.message);
    }
    if (defaultCount === 0) {
        defaults = [];
    }
    return {
        params: params,
        defaults: defaults,
        rest: rest,
        stricted: options.stricted,
        firstRestricted: options.firstRestricted,
        message: options.message
    };
}
function parseArrowFunctionExpression(options) {
    var previousStrict, previousYieldAllowed, body;
    expect('=>');
    previousStrict = strict;
    previousYieldAllowed = state.yieldAllowed;
    state.yieldAllowed = false;
    body = parseConciseBody();
    if (strict && options.firstRestricted) {
        throwError(options.firstRestricted, options.message);
    }
    if (strict && options.stricted) {
        throwErrorTolerant(options.stricted, options.message);
    }
    strict = previousStrict;
    state.yieldAllowed = previousYieldAllowed;
    return delegate.createArrowFunctionExpression(options.params, options.defaults, body, options.rest, body.type !== Syntax.BlockStatement);
}
function parseAssignmentExpression() {
    var expr, token, params, oldParenthesizedCount;
    if (matchKeyword('yield')) {
        return parseYieldExpression();
    }
    oldParenthesizedCount = state.parenthesizedCount;
    if (match('(')) {
        token = lookahead2();
        if (token.type === Token.Punctuator && token.value === ')' || token.value === '...') {
            params = parseParams();
            if (!match('=>')) {
                throwUnexpected(lex());
            }
            return parseArrowFunctionExpression(params);
        }
    }
    token = lookahead;
    expr = parseConditionalExpression();
    if (match('=>') && (state.parenthesizedCount === oldParenthesizedCount || state.parenthesizedCount === oldParenthesizedCount + 1)) {
        if (expr.type === Syntax.Identifier) {
            params = reinterpretAsCoverFormalsList([expr]);
        } else if (expr.type === Syntax.SequenceExpression) {
            params = reinterpretAsCoverFormalsList(expr.expressions);
        }
        if (params) {
            return parseArrowFunctionExpression(params);
        }
    }
    if (matchAssign()) {
        // 11.13.1
        if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
            throwErrorTolerant(token, Messages.StrictLHSAssignment);
        }
        // ES.next draf 11.13 Runtime Semantics step 1
        if (match('=') && (expr.type === Syntax.ObjectExpression || expr.type === Syntax.ArrayExpression)) {
            reinterpretAsAssignmentBindingPattern(expr);
        } else if (!isLeftHandSide(expr)) {
            throwError({}, Messages.InvalidLHSInAssignment);
        }
        expr = delegate.createAssignmentExpression(lex().value, expr, parseAssignmentExpression());
    }
    return expr;
}
// 11.14 Comma Operator
function parseExpression() {
    var expr, expressions, sequence, coverFormalsList, spreadFound, oldParenthesizedCount;
    oldParenthesizedCount = state.parenthesizedCount;
    expr = parseAssignmentExpression();
    expressions = [expr];
    if (match(',')) {
        while (streamIndex < length) {
            if (!match(',')) {
                break;
            }
            lex();
            expr = parseSpreadOrAssignmentExpression();
            expressions.push(expr);
            if (expr.type === Syntax.SpreadElement) {
                spreadFound = true;
                if (!match(')')) {
                    throwError({}, Messages.ElementAfterSpreadElement);
                }
                break;
            }
        }
        sequence = delegate.createSequenceExpression(expressions);
    }
    if (match('=>')) {
        // Do not allow nested parentheses on the LHS of the =>.
        if (state.parenthesizedCount === oldParenthesizedCount || state.parenthesizedCount === oldParenthesizedCount + 1) {
            expr = expr.type === Syntax.SequenceExpression ? expr.expressions : expressions;
            coverFormalsList = reinterpretAsCoverFormalsList(expr);
            if (coverFormalsList) {
                return parseArrowFunctionExpression(coverFormalsList);
            }
        }
        throwUnexpected(lex());
    }
    if (spreadFound && lookahead2().value !== '=>') {
        throwError({}, Messages.IllegalSpread);
    }
    return sequence || expr;
}
// 12.1 Block
function parseStatementList() {
    var list = [], statement;
    while (streamIndex < length) {
        if (match('}')) {
            break;
        }
        statement = parseSourceElement();
        if (typeof statement === 'undefined') {
            break;
        }
        list.push(statement);
    }
    return list;
}
function parseBlock() {
    var block;
    expect('{');
    block = parseStatementList();
    expect('}');
    return delegate.createBlockStatement(block);
}
// 12.2 Variable Statement
function parseVariableIdentifier() {
    var token = lookahead, resolvedIdent;
    if (token.type !== Token.Identifier) {
        throwUnexpected(token);
    }
    resolvedIdent = expander.resolve(tokenStream[lookaheadIndex]);
    lex();
    return delegate.createIdentifier(resolvedIdent);
}
function parseVariableDeclaration(kind) {
    var id, init = null;
    if (match('{')) {
        id = parseObjectInitialiser();
        reinterpretAsAssignmentBindingPattern(id);
    } else if (match('[')) {
        id = parseArrayInitialiser();
        reinterpretAsAssignmentBindingPattern(id);
    } else {
        id = state.allowKeyword ? parseNonComputedProperty() : parseVariableIdentifier();
        // 12.2.1
        if (strict && isRestrictedWord(id.name)) {
            throwErrorTolerant({}, Messages.StrictVarName);
        }
    }
    if (kind === 'const') {
        if (!match('=')) {
            throwError({}, Messages.NoUnintializedConst);
        }
        expect('=');
        init = parseAssignmentExpression();
    } else if (match('=')) {
        lex();
        init = parseAssignmentExpression();
    }
    return delegate.createVariableDeclarator(id, init);
}
function parseVariableDeclarationList(kind) {
    var list = [];
    do {
        list.push(parseVariableDeclaration(kind));
        if (!match(',')) {
            break;
        }
        lex();
    } while (streamIndex < length);
    return list;
}
function parseVariableStatement() {
    var declarations;
    expectKeyword('var');
    declarations = parseVariableDeclarationList();
    consumeSemicolon();
    return delegate.createVariableDeclaration(declarations, 'var');
}
// kind may be `const` or `let`
// Both are experimental and not in the specification yet.
// see http://wiki.ecmascript.org/doku.php?id=harmony:const
// and http://wiki.ecmascript.org/doku.php?id=harmony:let
function parseConstLetDeclaration(kind) {
    var declarations;
    expectKeyword(kind);
    declarations = parseVariableDeclarationList(kind);
    consumeSemicolon();
    return delegate.createVariableDeclaration(declarations, kind);
}
// http://wiki.ecmascript.org/doku.php?id=harmony:modules
function parseModuleDeclaration() {
    var id, src, body;
    lex();
    // 'module'
    if (peekLineTerminator()) {
        throwError({}, Messages.NewlineAfterModule);
    }
    switch (lookahead.type) {
    case Token.StringLiteral:
        id = parsePrimaryExpression();
        body = parseModuleBlock();
        src = null;
        break;
    case Token.Identifier:
        id = parseVariableIdentifier();
        body = null;
        if (!matchContextualKeyword('from')) {
            throwUnexpected(lex());
        }
        lex();
        src = parsePrimaryExpression();
        if (src.type !== Syntax.Literal) {
            throwError({}, Messages.InvalidModuleSpecifier);
        }
        break;
    }
    consumeSemicolon();
    return delegate.createModuleDeclaration(id, src, body);
}
function parseExportBatchSpecifier() {
    expect('*');
    return delegate.createExportBatchSpecifier();
}
function parseExportSpecifier() {
    var id, name = null;
    id = parseVariableIdentifier();
    if (matchContextualKeyword('as')) {
        lex();
        name = parseNonComputedProperty();
    }
    return delegate.createExportSpecifier(id, name);
}
function parseExportDeclaration() {
    var previousAllowKeyword, decl, def, src, specifiers;
    expectKeyword('export');
    if (lookahead.type === Token.Keyword) {
        switch (lookahead.value) {
        case 'let':
        case 'const':
        case 'var':
        case 'class':
        case 'function':
            return delegate.createExportDeclaration(parseSourceElement(), null, null);
        }
    }
    if (isIdentifierName(lookahead)) {
        previousAllowKeyword = state.allowKeyword;
        state.allowKeyword = true;
        decl = parseVariableDeclarationList('let');
        state.allowKeyword = previousAllowKeyword;
        return delegate.createExportDeclaration(decl, null, null);
    }
    specifiers = [];
    src = null;
    if (match('*')) {
        specifiers.push(parseExportBatchSpecifier());
    } else {
        expect('{');
        do {
            specifiers.push(parseExportSpecifier());
        } while (match(',') && lex());
        expect('}');
    }
    if (matchContextualKeyword('from')) {
        lex();
        src = parsePrimaryExpression();
        if (src.type !== Syntax.Literal) {
            throwError({}, Messages.InvalidModuleSpecifier);
        }
    }
    consumeSemicolon();
    return delegate.createExportDeclaration(null, specifiers, src);
}
function parseImportDeclaration() {
    var specifiers, kind, src;
    expectKeyword('import');
    specifiers = [];
    if (isIdentifierName(lookahead)) {
        kind = 'default';
        specifiers.push(parseImportSpecifier());
        if (!matchContextualKeyword('from')) {
            throwError({}, Messages.NoFromAfterImport);
        }
        lex();
    } else if (match('{')) {
        kind = 'named';
        lex();
        do {
            specifiers.push(parseImportSpecifier());
        } while (match(',') && lex());
        expect('}');
        if (!matchContextualKeyword('from')) {
            throwError({}, Messages.NoFromAfterImport);
        }
        lex();
    }
    src = parsePrimaryExpression();
    if (src.type !== Syntax.Literal) {
        throwError({}, Messages.InvalidModuleSpecifier);
    }
    consumeSemicolon();
    return delegate.createImportDeclaration(specifiers, kind, src);
}
function parseImportSpecifier() {
    var id, name = null;
    id = parseNonComputedProperty();
    if (matchContextualKeyword('as')) {
        lex();
        name = parseVariableIdentifier();
    }
    return delegate.createImportSpecifier(id, name);
}
// 12.3 Empty Statement
function parseEmptyStatement() {
    expect(';');
    return delegate.createEmptyStatement();
}
// 12.4 Expression Statement
function parseExpressionStatement() {
    var expr = parseExpression();
    consumeSemicolon();
    return delegate.createExpressionStatement(expr);
}
// 12.5 If statement
function parseIfStatement() {
    var test, consequent, alternate;
    expectKeyword('if');
    expect('(');
    test = parseExpression();
    expect(')');
    consequent = parseStatement();
    if (matchKeyword('else')) {
        lex();
        alternate = parseStatement();
    } else {
        alternate = null;
    }
    return delegate.createIfStatement(test, consequent, alternate);
}
// 12.6 Iteration Statements
function parseDoWhileStatement() {
    var body, test, oldInIteration;
    expectKeyword('do');
    oldInIteration = state.inIteration;
    state.inIteration = true;
    body = parseStatement();
    state.inIteration = oldInIteration;
    expectKeyword('while');
    expect('(');
    test = parseExpression();
    expect(')');
    if (match(';')) {
        lex();
    }
    return delegate.createDoWhileStatement(body, test);
}
function parseWhileStatement() {
    var test, body, oldInIteration;
    expectKeyword('while');
    expect('(');
    test = parseExpression();
    expect(')');
    oldInIteration = state.inIteration;
    state.inIteration = true;
    body = parseStatement();
    state.inIteration = oldInIteration;
    return delegate.createWhileStatement(test, body);
}
function parseForVariableDeclaration() {
    var token = lex(), declarations = parseVariableDeclarationList();
    return delegate.createVariableDeclaration(declarations, token.value);
}
function parseForStatement(opts) {
    var init, test, update, left, right, body, operator, oldInIteration;
    init = test = update = null;
    expectKeyword('for');
    // http://wiki.ecmascript.org/doku.php?id=proposals:iterators_and_generators&s=each
    if (matchContextualKeyword('each')) {
        throwError({}, Messages.EachNotAllowed);
    }
    expect('(');
    if (match(';')) {
        lex();
    } else {
        if (matchKeyword('var') || matchKeyword('let') || matchKeyword('const')) {
            state.allowIn = false;
            init = parseForVariableDeclaration();
            state.allowIn = true;
            if (init.declarations.length === 1) {
                if (matchKeyword('in') || matchContextualKeyword('of')) {
                    operator = lookahead;
                    if (!((operator.value === 'in' || init.kind !== 'var') && init.declarations[0].init)) {
                        lex();
                        left = init;
                        right = parseExpression();
                        init = null;
                    }
                }
            }
        } else {
            state.allowIn = false;
            init = parseExpression();
            state.allowIn = true;
            if (matchContextualKeyword('of')) {
                operator = lex();
                left = init;
                right = parseExpression();
                init = null;
            } else if (matchKeyword('in')) {
                // LeftHandSideExpression
                if (!isAssignableLeftHandSide(init)) {
                    throwError({}, Messages.InvalidLHSInForIn);
                }
                operator = lex();
                left = init;
                right = parseExpression();
                init = null;
            }
        }
        if (typeof left === 'undefined') {
            expect(';');
        }
    }
    if (typeof left === 'undefined') {
        if (!match(';')) {
            test = parseExpression();
        }
        expect(';');
        if (!match(')')) {
            update = parseExpression();
        }
    }
    expect(')');
    oldInIteration = state.inIteration;
    state.inIteration = true;
    if (!(opts !== undefined && opts.ignoreBody)) {
        body = parseStatement();
    }
    state.inIteration = oldInIteration;
    if (typeof left === 'undefined') {
        return delegate.createForStatement(init, test, update, body);
    }
    if (operator.value === 'in') {
        return delegate.createForInStatement(left, right, body);
    }
    return delegate.createForOfStatement(left, right, body);
}
// 12.7 The continue statement
function parseContinueStatement() {
    var label = null, key;
    expectKeyword('continue');
    // Optimize the most common form: 'continue;'.
    if (lookahead.value.charCodeAt(0) === 59) {
        lex();
        if (!state.inIteration) {
            throwError({}, Messages.IllegalContinue);
        }
        return delegate.createContinueStatement(null);
    }
    if (peekLineTerminator()) {
        if (!state.inIteration) {
            throwError({}, Messages.IllegalContinue);
        }
        return delegate.createContinueStatement(null);
    }
    if (lookahead.type === Token.Identifier) {
        label = parseVariableIdentifier();
        key = '$' + label.name;
        if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
            throwError({}, Messages.UnknownLabel, label.name);
        }
    }
    consumeSemicolon();
    if (label === null && !state.inIteration) {
        throwError({}, Messages.IllegalContinue);
    }
    return delegate.createContinueStatement(label);
}
// 12.8 The break statement
function parseBreakStatement() {
    var label = null, key;
    expectKeyword('break');
    // Catch the very common case first: immediately a semicolon (char #59).
    if (lookahead.value.charCodeAt(0) === 59) {
        lex();
        if (!(state.inIteration || state.inSwitch)) {
            throwError({}, Messages.IllegalBreak);
        }
        return delegate.createBreakStatement(null);
    }
    if (peekLineTerminator()) {
        if (!(state.inIteration || state.inSwitch)) {
            throwError({}, Messages.IllegalBreak);
        }
        return delegate.createBreakStatement(null);
    }
    if (lookahead.type === Token.Identifier) {
        label = parseVariableIdentifier();
        key = '$' + label.name;
        if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
            throwError({}, Messages.UnknownLabel, label.name);
        }
    }
    consumeSemicolon();
    if (label === null && !(state.inIteration || state.inSwitch)) {
        throwError({}, Messages.IllegalBreak);
    }
    return delegate.createBreakStatement(label);
}
// 12.9 The return statement
function parseReturnStatement() {
    var argument = null;
    expectKeyword('return');
    if (!state.inFunctionBody) {
        throwErrorTolerant({}, Messages.IllegalReturn);
    }
    // 'return' followed by a space and an identifier is very common.
    if (isIdentifierStart(String(lookahead.value).charCodeAt(0))) {
        argument = parseExpression();
        consumeSemicolon();
        return delegate.createReturnStatement(argument);
    }
    if (peekLineTerminator()) {
        return delegate.createReturnStatement(null);
    }
    if (!match(';')) {
        if (!match('}') && lookahead.type !== Token.EOF) {
            argument = parseExpression();
        }
    }
    consumeSemicolon();
    return delegate.createReturnStatement(argument);
}
// 12.10 The with statement
function parseWithStatement() {
    var object, body;
    if (strict) {
        throwErrorTolerant({}, Messages.StrictModeWith);
    }
    expectKeyword('with');
    expect('(');
    object = parseExpression();
    expect(')');
    body = parseStatement();
    return delegate.createWithStatement(object, body);
}
// 12.10 The swith statement
function parseSwitchCase() {
    var test, consequent = [], sourceElement;
    if (matchKeyword('default')) {
        lex();
        test = null;
    } else {
        expectKeyword('case');
        test = parseExpression();
    }
    expect(':');
    while (streamIndex < length) {
        if (match('}') || matchKeyword('default') || matchKeyword('case')) {
            break;
        }
        sourceElement = parseSourceElement();
        if (typeof sourceElement === 'undefined') {
            break;
        }
        consequent.push(sourceElement);
    }
    return delegate.createSwitchCase(test, consequent);
}
function parseSwitchStatement() {
    var discriminant, cases, clause, oldInSwitch, defaultFound;
    expectKeyword('switch');
    expect('(');
    discriminant = parseExpression();
    expect(')');
    expect('{');
    cases = [];
    if (match('}')) {
        lex();
        return delegate.createSwitchStatement(discriminant, cases);
    }
    oldInSwitch = state.inSwitch;
    state.inSwitch = true;
    defaultFound = false;
    while (streamIndex < length) {
        if (match('}')) {
            break;
        }
        clause = parseSwitchCase();
        if (clause.test === null) {
            if (defaultFound) {
                throwError({}, Messages.MultipleDefaultsInSwitch);
            }
            defaultFound = true;
        }
        cases.push(clause);
    }
    state.inSwitch = oldInSwitch;
    expect('}');
    return delegate.createSwitchStatement(discriminant, cases);
}
// 12.13 The throw statement
function parseThrowStatement() {
    var argument;
    expectKeyword('throw');
    if (peekLineTerminator()) {
        throwError({}, Messages.NewlineAfterThrow);
    }
    argument = parseExpression();
    consumeSemicolon();
    return delegate.createThrowStatement(argument);
}
// 12.14 The try statement
function parseCatchClause() {
    var param, body;
    expectKeyword('catch');
    expect('(');
    if (match(')')) {
        throwUnexpected(lookahead);
    }
    param = parseExpression();
    // 12.14.1
    if (strict && param.type === Syntax.Identifier && isRestrictedWord(param.name)) {
        throwErrorTolerant({}, Messages.StrictCatchVariable);
    }
    expect(')');
    body = parseBlock();
    return delegate.createCatchClause(param, body);
}
function parseTryStatement() {
    var block, handlers = [], finalizer = null;
    expectKeyword('try');
    block = parseBlock();
    if (matchKeyword('catch')) {
        handlers.push(parseCatchClause());
    }
    if (matchKeyword('finally')) {
        lex();
        finalizer = parseBlock();
    }
    if (handlers.length === 0 && !finalizer) {
        throwError({}, Messages.NoCatchOrFinally);
    }
    return delegate.createTryStatement(block, [], handlers, finalizer);
}
// 12.15 The debugger statement
function parseDebuggerStatement() {
    expectKeyword('debugger');
    consumeSemicolon();
    return delegate.createDebuggerStatement();
}
// 12 Statements
function parseStatement() {
    var type = lookahead.type, expr, labeledBody, key;
    if (type === Token.EOF) {
        throwUnexpected(lookahead);
    }
    if (type === Token.Punctuator) {
        switch (lookahead.value) {
        case ';':
            return parseEmptyStatement();
        case '{':
            return parseBlock();
        case '(':
            return parseExpressionStatement();
        default:
            break;
        }
    }
    if (type === Token.Keyword) {
        switch (lookahead.value) {
        case 'break':
            return parseBreakStatement();
        case 'continue':
            return parseContinueStatement();
        case 'debugger':
            return parseDebuggerStatement();
        case 'do':
            return parseDoWhileStatement();
        case 'for':
            return parseForStatement();
        case 'function':
            return parseFunctionDeclaration();
        case 'class':
            return parseClassDeclaration();
        case 'if':
            return parseIfStatement();
        case 'return':
            return parseReturnStatement();
        case 'switch':
            return parseSwitchStatement();
        case 'throw':
            return parseThrowStatement();
        case 'try':
            return parseTryStatement();
        case 'var':
            return parseVariableStatement();
        case 'while':
            return parseWhileStatement();
        case 'with':
            return parseWithStatement();
        default:
            break;
        }
    }
    expr = parseExpression();
    // 12.12 Labelled Statements
    if (expr.type === Syntax.Identifier && match(':')) {
        lex();
        key = '$' + expr.name;
        if (Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
            throwError({}, Messages.Redeclaration, 'Label', expr.name);
        }
        state.labelSet[key] = true;
        labeledBody = parseStatement();
        delete state.labelSet[key];
        return delegate.createLabeledStatement(expr, labeledBody);
    }
    consumeSemicolon();
    return delegate.createExpressionStatement(expr);
}
// 13 Function Definition
function parseConciseBody() {
    if (match('{')) {
        return parseFunctionSourceElements();
    }
    return parseAssignmentExpression();
}
function parseFunctionSourceElements() {
    var sourceElement, sourceElements = [], token, directive, firstRestricted, oldLabelSet, oldInIteration, oldInSwitch, oldInFunctionBody, oldParenthesizedCount;
    expect('{');
    while (streamIndex < length) {
        if (lookahead.type !== Token.StringLiteral) {
            break;
        }
        token = lookahead;
        sourceElement = parseSourceElement();
        sourceElements.push(sourceElement);
        if (sourceElement.expression.type !== Syntax.Literal) {
            // this is not directive
            break;
        }
        directive = token.value;
        if (directive === 'use strict') {
            strict = true;
            if (firstRestricted) {
                throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
            }
        } else {
            if (!firstRestricted && token.octal) {
                firstRestricted = token;
            }
        }
    }
    oldLabelSet = state.labelSet;
    oldInIteration = state.inIteration;
    oldInSwitch = state.inSwitch;
    oldInFunctionBody = state.inFunctionBody;
    oldParenthesizedCount = state.parenthesizedCount;
    state.labelSet = {};
    state.inIteration = false;
    state.inSwitch = false;
    state.inFunctionBody = true;
    state.parenthesizedCount = 0;
    while (streamIndex < length) {
        if (match('}')) {
            break;
        }
        sourceElement = parseSourceElement();
        if (typeof sourceElement === 'undefined') {
            break;
        }
        sourceElements.push(sourceElement);
    }
    expect('}');
    state.labelSet = oldLabelSet;
    state.inIteration = oldInIteration;
    state.inSwitch = oldInSwitch;
    state.inFunctionBody = oldInFunctionBody;
    state.parenthesizedCount = oldParenthesizedCount;
    return delegate.createBlockStatement(sourceElements);
}
function validateParam(options, param, name) {
    var key = '$' + name;
    if (strict) {
        if (isRestrictedWord(name)) {
            options.stricted = param;
            options.message = Messages.StrictParamName;
        }
        if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
            options.stricted = param;
            options.message = Messages.StrictParamDupe;
        }
    } else if (!options.firstRestricted) {
        if (isRestrictedWord(name)) {
            options.firstRestricted = param;
            options.message = Messages.StrictParamName;
        } else if (isStrictModeReservedWord(name)) {
            options.firstRestricted = param;
            options.message = Messages.StrictReservedWord;
        } else if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
            options.firstRestricted = param;
            options.message = Messages.StrictParamDupe;
        }
    }
    options.paramSet[key] = true;
}
function parseParam(options) {
    var token, rest, param, def;
    token = lookahead;
    if (token.value === '...') {
        token = lex();
        rest = true;
    }
    if (match('[')) {
        param = parseArrayInitialiser();
        reinterpretAsDestructuredParameter(options, param);
    } else if (match('{')) {
        if (rest) {
            throwError({}, Messages.ObjectPatternAsRestParameter);
        }
        param = parseObjectInitialiser();
        reinterpretAsDestructuredParameter(options, param);
    } else {
        param = parseVariableIdentifier();
        validateParam(options, token, token.value);
        if (match('=')) {
            if (rest) {
                throwErrorTolerant(lookahead, Messages.DefaultRestParameter);
            }
            lex();
            def = parseAssignmentExpression();
            ++options.defaultCount;
        }
    }
    if (rest) {
        if (!match(')')) {
            throwError({}, Messages.ParameterAfterRestParameter);
        }
        options.rest = param;
        return false;
    }
    options.params.push(param);
    options.defaults.push(def);
    return !match(')');
}
function parseParams(firstRestricted) {
    var options;
    options = {
        params: [],
        defaultCount: 0,
        defaults: [],
        rest: null,
        firstRestricted: firstRestricted
    };
    expect('(');
    if (!match(')')) {
        options.paramSet = {};
        while (streamIndex < length) {
            if (!parseParam(options)) {
                break;
            }
            expect(',');
        }
    }
    expect(')');
    if (options.defaultCount === 0) {
        options.defaults = [];
    }
    return options;
}
function parseFunctionDeclaration() {
    var id, body, token, tmp, firstRestricted, message, previousStrict, previousYieldAllowed, generator, expression;
    expectKeyword('function');
    generator = false;
    if (match('*')) {
        lex();
        generator = true;
    }
    token = lookahead;
    id = parseVariableIdentifier();
    if (strict) {
        if (isRestrictedWord(token.value)) {
            throwErrorTolerant(token, Messages.StrictFunctionName);
        }
    } else {
        if (isRestrictedWord(token.value)) {
            firstRestricted = token;
            message = Messages.StrictFunctionName;
        } else if (isStrictModeReservedWord(token.value)) {
            firstRestricted = token;
            message = Messages.StrictReservedWord;
        }
    }
    tmp = parseParams(firstRestricted);
    firstRestricted = tmp.firstRestricted;
    if (tmp.message) {
        message = tmp.message;
    }
    previousStrict = strict;
    previousYieldAllowed = state.yieldAllowed;
    state.yieldAllowed = generator;
    // here we redo some work in order to set 'expression'
    expression = !match('{');
    body = parseConciseBody();
    if (strict && firstRestricted) {
        throwError(firstRestricted, message);
    }
    if (strict && tmp.stricted) {
        throwErrorTolerant(tmp.stricted, message);
    }
    if (state.yieldAllowed && !state.yieldFound) {
        throwErrorTolerant({}, Messages.NoYieldInGenerator);
    }
    strict = previousStrict;
    state.yieldAllowed = previousYieldAllowed;
    return delegate.createFunctionDeclaration(id, tmp.params, tmp.defaults, body, tmp.rest, generator, expression);
}
function parseFunctionExpression() {
    var token, id = null, firstRestricted, message, tmp, body, previousStrict, previousYieldAllowed, generator, expression;
    expectKeyword('function');
    generator = false;
    if (match('*')) {
        lex();
        generator = true;
    }
    if (!match('(')) {
        token = lookahead;
        id = parseVariableIdentifier();
        if (strict) {
            if (isRestrictedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictFunctionName);
            }
        } else {
            if (isRestrictedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictFunctionName;
            } else if (isStrictModeReservedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictReservedWord;
            }
        }
    }
    tmp = parseParams(firstRestricted);
    firstRestricted = tmp.firstRestricted;
    if (tmp.message) {
        message = tmp.message;
    }
    previousStrict = strict;
    previousYieldAllowed = state.yieldAllowed;
    state.yieldAllowed = generator;
    // here we redo some work in order to set 'expression'
    expression = !match('{');
    body = parseConciseBody();
    if (strict && firstRestricted) {
        throwError(firstRestricted, message);
    }
    if (strict && tmp.stricted) {
        throwErrorTolerant(tmp.stricted, message);
    }
    if (state.yieldAllowed && !state.yieldFound) {
        throwErrorTolerant({}, Messages.NoYieldInGenerator);
    }
    strict = previousStrict;
    state.yieldAllowed = previousYieldAllowed;
    return delegate.createFunctionExpression(id, tmp.params, tmp.defaults, body, tmp.rest, generator, expression);
}
function parseYieldExpression() {
    var delegateFlag, expr, previousYieldAllowed;
    expectKeyword('yield');
    if (!state.yieldAllowed) {
        throwErrorTolerant({}, Messages.IllegalYield);
    }
    delegateFlag = false;
    if (match('*')) {
        lex();
        delegateFlag = true;
    }
    // It is a Syntax Error if any AssignmentExpression Contains YieldExpression.
    previousYieldAllowed = state.yieldAllowed;
    state.yieldAllowed = false;
    expr = parseAssignmentExpression();
    state.yieldAllowed = previousYieldAllowed;
    state.yieldFound = true;
    return delegate.createYieldExpression(expr, delegateFlag);
}
// 14 Classes
function parseMethodDefinition(existingPropNames) {
    var token, key, param, propType, isValidDuplicateProp = false;
    if (lookahead.value === 'static') {
        propType = ClassPropertyType.static;
        lex();
    } else {
        propType = ClassPropertyType.prototype;
    }
    if (match('*')) {
        lex();
        return delegate.createMethodDefinition(propType, '', parseObjectPropertyKey(), parsePropertyMethodFunction({ generator: true }));
    }
    token = lookahead;
    key = parseObjectPropertyKey();
    if (token.value === 'get' && !match('(')) {
        key = parseObjectPropertyKey();
        // It is a syntax error if any other properties have a name
        // duplicating this one unless they are a setter
        if (existingPropNames[propType].hasOwnProperty(key.name)) {
            isValidDuplicateProp = existingPropNames[propType][key.name].get === undefined && existingPropNames[propType][key.name].data === undefined && existingPropNames[propType][key.name].set !== undefined;
            if (!isValidDuplicateProp) {
                throwError(key, Messages.IllegalDuplicateClassProperty);
            }
        } else {
            existingPropNames[propType][key.name] = {};
        }
        existingPropNames[propType][key.name].get = true;
        expect('(');
        expect(')');
        return delegate.createMethodDefinition(propType, 'get', key, parsePropertyFunction({ generator: false }));
    }
    if (token.value === 'set' && !match('(')) {
        key = parseObjectPropertyKey();
        // It is a syntax error if any other properties have a name
        // duplicating this one unless they are a getter
        if (existingPropNames[propType].hasOwnProperty(key.name)) {
            isValidDuplicateProp = existingPropNames[propType][key.name].set === undefined && existingPropNames[propType][key.name].data === undefined && existingPropNames[propType][key.name].get !== undefined;
            if (!isValidDuplicateProp) {
                throwError(key, Messages.IllegalDuplicateClassProperty);
            }
        } else {
            existingPropNames[propType][key.name] = {};
        }
        existingPropNames[propType][key.name].set = true;
        expect('(');
        token = lookahead;
        param = [parseVariableIdentifier()];
        expect(')');
        return delegate.createMethodDefinition(propType, 'set', key, parsePropertyFunction({
            params: param,
            generator: false,
            name: token
        }));
    }
    // It is a syntax error if any other properties have the same name as a
    // non-getter, non-setter method
    if (existingPropNames[propType].hasOwnProperty(key.name)) {
        throwError(key, Messages.IllegalDuplicateClassProperty);
    } else {
        existingPropNames[propType][key.name] = {};
    }
    existingPropNames[propType][key.name].data = true;
    return delegate.createMethodDefinition(propType, '', key, parsePropertyMethodFunction({ generator: false }));
}
function parseClassElement(existingProps) {
    if (match(';')) {
        lex();
        return;
    }
    return parseMethodDefinition(existingProps);
}
function parseClassBody() {
    var classElement, classElements = [], existingProps = {};
    existingProps[ClassPropertyType.static] = {};
    existingProps[ClassPropertyType.prototype] = {};
    expect('{');
    while (streamIndex < length) {
        if (match('}')) {
            break;
        }
        classElement = parseClassElement(existingProps);
        if (typeof classElement !== 'undefined') {
            classElements.push(classElement);
        }
    }
    expect('}');
    return delegate.createClassBody(classElements);
}
function parseClassExpression() {
    var id, previousYieldAllowed, superClass = null;
    expectKeyword('class');
    if (!matchKeyword('extends') && !match('{')) {
        id = parseVariableIdentifier();
    }
    if (matchKeyword('extends')) {
        expectKeyword('extends');
        previousYieldAllowed = state.yieldAllowed;
        state.yieldAllowed = false;
        superClass = parseAssignmentExpression();
        state.yieldAllowed = previousYieldAllowed;
    }
    return delegate.createClassExpression(id, superClass, parseClassBody());
}
function parseClassDeclaration() {
    var id, previousYieldAllowed, superClass = null;
    expectKeyword('class');
    id = parseVariableIdentifier();
    if (matchKeyword('extends')) {
        expectKeyword('extends');
        previousYieldAllowed = state.yieldAllowed;
        state.yieldAllowed = false;
        superClass = parseAssignmentExpression();
        state.yieldAllowed = previousYieldAllowed;
    }
    return delegate.createClassDeclaration(id, superClass, parseClassBody());
}
// 15 Program
function matchModuleDeclaration() {
    var id;
    if (matchContextualKeyword('module')) {
        id = lookahead2();
        return id.type === Token.StringLiteral || id.type === Token.Identifier;
    }
    return false;
}
function parseSourceElement() {
    if (lookahead.type === Token.Keyword) {
        switch (lookahead.value) {
        case 'const':
        case 'let':
            return parseConstLetDeclaration(lookahead.value);
        case 'function':
            return parseFunctionDeclaration();
        case 'export':
            return parseExportDeclaration();
        case 'import':
            return parseImportDeclaration();
        default:
            return parseStatement();
        }
    }
    if (matchModuleDeclaration()) {
        throwError({}, Messages.NestedModule);
    }
    if (lookahead.type !== Token.EOF) {
        return parseStatement();
    }
}
function parseProgramElement() {
    if (lookahead.type === Token.Keyword) {
        switch (lookahead.value) {
        case 'export':
            return parseExportDeclaration();
        case 'import':
            return parseImportDeclaration();
        }
    }
    if (matchModuleDeclaration()) {
        return parseModuleDeclaration();
    }
    return parseSourceElement();
}
function parseProgramElements() {
    var sourceElement, sourceElements = [], token, directive, firstRestricted;
    while (streamIndex < length) {
        token = lookahead;
        if (token.type !== Token.StringLiteral) {
            break;
        }
        sourceElement = parseProgramElement();
        sourceElements.push(sourceElement);
        if (sourceElement.expression.type !== Syntax.Literal) {
            // this is not directive
            break;
        }
        directive = token.value;
        if (directive === 'use strict') {
            strict = true;
            if (firstRestricted) {
                throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
            }
        } else {
            if (!firstRestricted && token.octal) {
                firstRestricted = token;
            }
        }
    }
    while (streamIndex < length) {
        sourceElement = parseProgramElement();
        if (typeof sourceElement === 'undefined') {
            break;
        }
        sourceElements.push(sourceElement);
    }
    return sourceElements;
}
function parseModuleElement() {
    return parseSourceElement();
}
function parseModuleElements() {
    var list = [], statement;
    while (streamIndex < length) {
        if (match('}')) {
            break;
        }
        statement = parseModuleElement();
        if (typeof statement === 'undefined') {
            break;
        }
        list.push(statement);
    }
    return list;
}
function parseModuleBlock() {
    var block;
    expect('{');
    block = parseModuleElements();
    expect('}');
    return delegate.createBlockStatement(block);
}
function parseProgram() {
    var body;
    strict = false;
    peek();
    body = parseProgramElements();
    return delegate.createProgram(body);
}
// The following functions are needed only when the option to preserve
// the comments is active.
function addComment(type, value, start, end, loc) {
    assert(typeof start === 'number', 'Comment must have valid position');
    // Because the way the actual token is scanned, often the comments
    // (if any) are skipped twice during the lexical analysis.
    // Thus, we need to skip adding a comment if the comment array already
    // handled it.
    if (extra.comments.length > 0) {
        if (extra.comments[extra.comments.length - 1].range[1] > start) {
            return;
        }
    }
    extra.comments.push({
        type: type,
        value: value,
        range: [
            start,
            end
        ],
        loc: loc
    });
}
function scanComment() {
    var comment, ch, loc, start, blockComment, lineComment;
    comment = '';
    blockComment = false;
    lineComment = false;
    while (index < length) {
        ch = source[index];
        if (lineComment) {
            ch = source[index++];
            if (isLineTerminator(ch.charCodeAt(0))) {
                loc.end = {
                    line: lineNumber,
                    column: index - lineStart - 1
                };
                lineComment = false;
                addComment('Line', comment, start, index - 1, loc);
                if (ch === '\r' && source[index] === '\n') {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
                comment = '';
            } else if (index >= length) {
                lineComment = false;
                comment += ch;
                loc.end = {
                    line: lineNumber,
                    column: length - lineStart
                };
                addComment('Line', comment, start, length, loc);
            } else {
                comment += ch;
            }
        } else if (blockComment) {
            if (isLineTerminator(ch.charCodeAt(0))) {
                if (ch === '\r' && source[index + 1] === '\n') {
                    ++index;
                    comment += '\r\n';
                } else {
                    comment += ch;
                }
                ++lineNumber;
                ++index;
                lineStart = index;
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            } else {
                ch = source[index++];
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                comment += ch;
                if (ch === '*') {
                    ch = source[index];
                    if (ch === '/') {
                        comment = comment.substr(0, comment.length - 1);
                        blockComment = false;
                        ++index;
                        loc.end = {
                            line: lineNumber,
                            column: index - lineStart
                        };
                        addComment('Block', comment, start, index, loc);
                        comment = '';
                    }
                }
            }
        } else if (ch === '/') {
            ch = source[index + 1];
            if (ch === '/') {
                loc = {
                    start: {
                        line: lineNumber,
                        column: index - lineStart
                    }
                };
                start = index;
                index += 2;
                lineComment = true;
                if (index >= length) {
                    loc.end = {
                        line: lineNumber,
                        column: index - lineStart
                    };
                    lineComment = false;
                    addComment('Line', comment, start, index, loc);
                }
            } else if (ch === '*') {
                start = index;
                index += 2;
                blockComment = true;
                loc = {
                    start: {
                        line: lineNumber,
                        column: index - lineStart - 2
                    }
                };
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            } else {
                break;
            }
        } else if (isWhiteSpace(ch.charCodeAt(0))) {
            ++index;
        } else if (isLineTerminator(ch.charCodeAt(0))) {
            ++index;
            if (ch === '\r' && source[index] === '\n') {
                ++index;
            }
            ++lineNumber;
            lineStart = index;
        } else {
            break;
        }
    }
}
function filterCommentLocation() {
    var i, entry, comment, comments = [];
    for (i = 0; i < extra.comments.length; ++i) {
        entry = extra.comments[i];
        comment = {
            type: entry.type,
            value: entry.value
        };
        if (extra.range) {
            comment.range = entry.range;
        }
        if (extra.loc) {
            comment.loc = entry.loc;
        }
        comments.push(comment);
    }
    extra.comments = comments;
}
function collectToken() {
    var start, loc, token, range, value;
    skipComment();
    start = index;
    loc = {
        start: {
            line: lineNumber,
            column: index - lineStart
        }
    };
    token = extra.advance();
    loc.end = {
        line: lineNumber,
        column: index - lineStart
    };
    if (token.type !== Token.EOF) {
        range = [
            token.range[0],
            token.range[1]
        ];
        value = source.slice(token.range[0], token.range[1]);
        extra.tokens.push({
            type: TokenName[token.type],
            value: value,
            range: range,
            loc: loc
        });
    }
    return token;
}
function collectRegex() {
    var pos, loc, regex, token;
    skipComment();
    pos = index;
    loc = {
        start: {
            line: lineNumber,
            column: index - lineStart
        }
    };
    regex = extra.scanRegExp();
    loc.end = {
        line: lineNumber,
        column: index - lineStart
    };
    if (!extra.tokenize) {
        // Pop the previous token, which is likely '/' or '/='
        if (extra.tokens.length > 0) {
            token = extra.tokens[extra.tokens.length - 1];
            if (token.range[0] === pos && token.type === 'Punctuator') {
                if (token.value === '/' || token.value === '/=') {
                    extra.tokens.pop();
                }
            }
        }
        extra.tokens.push({
            type: 'RegularExpression',
            value: regex.literal,
            range: [
                pos,
                index
            ],
            loc: loc
        });
    }
    return regex;
}
function filterTokenLocation() {
    var i, entry, token, tokens = [];
    for (i = 0; i < extra.tokens.length; ++i) {
        entry = extra.tokens[i];
        token = {
            type: entry.type,
            value: entry.value
        };
        if (extra.range) {
            token.range = entry.range;
        }
        if (extra.loc) {
            token.loc = entry.loc;
        }
        tokens.push(token);
    }
    extra.tokens = tokens;
}
function LocationMarker() {
    var sm_index$2 = lookahead ? lookahead.sm_range[0] : 0;
    var sm_lineStart$2 = lookahead ? lookahead.sm_lineStart : 0;
    var sm_lineNumber$2 = lookahead ? lookahead.sm_lineNumber : 1;
    this.range = [
        sm_index$2,
        sm_index$2
    ];
    this.loc = {
        start: {
            line: sm_lineNumber$2,
            column: sm_index$2 - sm_lineStart$2
        },
        end: {
            line: sm_lineNumber$2,
            column: sm_index$2 - sm_lineStart$2
        }
    };
}
LocationMarker.prototype = {
    constructor: LocationMarker,
    end: function () {
        this.range[1] = sm_index;
        this.loc.end.line = sm_lineNumber;
        this.loc.end.column = sm_index - sm_lineStart;
    },
    applyGroup: function (node) {
        if (extra.range) {
            node.groupRange = [
                this.range[0],
                this.range[1]
            ];
        }
        if (extra.loc) {
            node.groupLoc = {
                start: {
                    line: this.loc.start.line,
                    column: this.loc.start.column
                },
                end: {
                    line: this.loc.end.line,
                    column: this.loc.end.column
                }
            };
            node = delegate.postProcess(node);
        }
    },
    apply: function (node) {
        var nodeType = typeof node;
        assert(nodeType === 'object', 'Applying location marker to an unexpected node type: ' + nodeType);
        if (extra.range) {
            node.range = [
                this.range[0],
                this.range[1]
            ];
        }
        if (extra.loc) {
            node.loc = {
                start: {
                    line: this.loc.start.line,
                    column: this.loc.start.column
                },
                end: {
                    line: this.loc.end.line,
                    column: this.loc.end.column
                }
            };
            node = delegate.postProcess(node);
        }
    }
};
function createLocationMarker() {
    return new LocationMarker();
}
function trackGroupExpression() {
    var marker, expr;
    marker = createLocationMarker();
    expect('(');
    ++state.parenthesizedCount;
    expr = parseExpression();
    expect(')');
    marker.end();
    marker.applyGroup(expr);
    return expr;
}
function trackLeftHandSideExpression() {
    var marker, expr;
    // skipComment();
    marker = createLocationMarker();
    expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();
    while (match('.') || match('[') || lookahead.type === Token.Template) {
        if (match('[')) {
            expr = delegate.createMemberExpression('[', expr, parseComputedMember());
            marker.end();
            marker.apply(expr);
        } else if (match('.')) {
            expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
            marker.end();
            marker.apply(expr);
        } else {
            expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
            marker.end();
            marker.apply(expr);
        }
    }
    return expr;
}
function trackLeftHandSideExpressionAllowCall() {
    var marker, expr, args;
    // skipComment();
    marker = createLocationMarker();
    expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();
    while (match('.') || match('[') || match('(') || lookahead.type === Token.Template) {
        if (match('(')) {
            args = parseArguments();
            expr = delegate.createCallExpression(expr, args);
            marker.end();
            marker.apply(expr);
        } else if (match('[')) {
            expr = delegate.createMemberExpression('[', expr, parseComputedMember());
            marker.end();
            marker.apply(expr);
        } else if (match('.')) {
            expr = delegate.createMemberExpression('.', expr, parseNonComputedMember());
            marker.end();
            marker.apply(expr);
        } else {
            expr = delegate.createTaggedTemplateExpression(expr, parseTemplateLiteral());
            marker.end();
            marker.apply(expr);
        }
    }
    return expr;
}
function filterGroup(node) {
    var n, i, entry;
    n = Object.prototype.toString.apply(node) === '[object Array]' ? [] : {};
    for (i in node) {
        if (node.hasOwnProperty(i) && i !== 'groupRange' && i !== 'groupLoc') {
            entry = node[i];
            if (entry === null || typeof entry !== 'object' || entry instanceof RegExp) {
                n[i] = entry;
            } else {
                n[i] = filterGroup(entry);
            }
        }
    }
    return n;
}
function wrapTrackingFunction(range, loc) {
    return function (parseFunction) {
        function isBinary(node) {
            return node.type === Syntax.LogicalExpression || node.type === Syntax.BinaryExpression;
        }
        function visit(node) {
            var start, end;
            if (isBinary(node.left)) {
                visit(node.left);
            }
            if (isBinary(node.right)) {
                visit(node.right);
            }
            if (range) {
                if (node.left.groupRange || node.right.groupRange) {
                    start = node.left.groupRange ? node.left.groupRange[0] : node.left.range[0];
                    end = node.right.groupRange ? node.right.groupRange[1] : node.right.range[1];
                    node.range = [
                        start,
                        end
                    ];
                } else if (typeof node.range === 'undefined') {
                    start = node.left.range[0];
                    end = node.right.range[1];
                    node.range = [
                        start,
                        end
                    ];
                }
            }
            if (loc) {
                if (node.left.groupLoc || node.right.groupLoc) {
                    start = node.left.groupLoc ? node.left.groupLoc.start : node.left.loc.start;
                    end = node.right.groupLoc ? node.right.groupLoc.end : node.right.loc.end;
                    node.loc = {
                        start: start,
                        end: end
                    };
                    node = delegate.postProcess(node);
                } else if (typeof node.loc === 'undefined') {
                    node.loc = {
                        start: node.left.loc.start,
                        end: node.right.loc.end
                    };
                    node = delegate.postProcess(node);
                }
            }
        }
        return function () {
            var marker, node, curr = lookahead;
            marker = createLocationMarker();
            node = parseFunction.apply(null, arguments);
            marker.end();
            if (node.type !== Syntax.Program) {
                if (curr.leadingComments) {
                    node.leadingComments = curr.leadingComments;
                }
                if (curr.trailingComments) {
                    node.trailingComments = curr.trailingComments;
                }
            }
            if (range && typeof node.range === 'undefined') {
                marker.apply(node);
            }
            if (loc && typeof node.loc === 'undefined') {
                marker.apply(node);
            }
            if (isBinary(node)) {
                visit(node);
            }
            return node;
        };
    };
}
function patch() {
    var wrapTracking;
    if (extra.comments) {
        extra.skipComment = skipComment;
        skipComment = scanComment;
    }
    if (extra.range || extra.loc) {
        extra.parseGroupExpression = parseGroupExpression;
        extra.parseLeftHandSideExpression = parseLeftHandSideExpression;
        extra.parseLeftHandSideExpressionAllowCall = parseLeftHandSideExpressionAllowCall;
        parseGroupExpression = trackGroupExpression;
        parseLeftHandSideExpression = trackLeftHandSideExpression;
        parseLeftHandSideExpressionAllowCall = trackLeftHandSideExpressionAllowCall;
        wrapTracking = wrapTrackingFunction(extra.range, extra.loc);
        extra.parseArrayInitialiser = parseArrayInitialiser;
        extra.parseAssignmentExpression = parseAssignmentExpression;
        extra.parseBinaryExpression = parseBinaryExpression;
        extra.parseBlock = parseBlock;
        extra.parseFunctionSourceElements = parseFunctionSourceElements;
        extra.parseCatchClause = parseCatchClause;
        extra.parseComputedMember = parseComputedMember;
        extra.parseConditionalExpression = parseConditionalExpression;
        extra.parseConstLetDeclaration = parseConstLetDeclaration;
        extra.parseExportBatchSpecifier = parseExportBatchSpecifier;
        extra.parseExportDeclaration = parseExportDeclaration;
        extra.parseExportSpecifier = parseExportSpecifier;
        extra.parseExpression = parseExpression;
        extra.parseForVariableDeclaration = parseForVariableDeclaration;
        extra.parseFunctionDeclaration = parseFunctionDeclaration;
        extra.parseFunctionExpression = parseFunctionExpression;
        extra.parseParams = parseParams;
        extra.parseImportDeclaration = parseImportDeclaration;
        extra.parseImportSpecifier = parseImportSpecifier;
        extra.parseModuleDeclaration = parseModuleDeclaration;
        extra.parseModuleBlock = parseModuleBlock;
        extra.parseNewExpression = parseNewExpression;
        extra.parseNonComputedProperty = parseNonComputedProperty;
        extra.parseObjectInitialiser = parseObjectInitialiser;
        extra.parseObjectProperty = parseObjectProperty;
        extra.parseObjectPropertyKey = parseObjectPropertyKey;
        extra.parsePostfixExpression = parsePostfixExpression;
        extra.parsePrimaryExpression = parsePrimaryExpression;
        extra.parseProgram = parseProgram;
        extra.parsePropertyFunction = parsePropertyFunction;
        extra.parseSpreadOrAssignmentExpression = parseSpreadOrAssignmentExpression;
        extra.parseTemplateElement = parseTemplateElement;
        extra.parseTemplateLiteral = parseTemplateLiteral;
        extra.parseStatement = parseStatement;
        extra.parseSwitchCase = parseSwitchCase;
        extra.parseUnaryExpression = parseUnaryExpression;
        extra.parseVariableDeclaration = parseVariableDeclaration;
        extra.parseVariableIdentifier = parseVariableIdentifier;
        extra.parseMethodDefinition = parseMethodDefinition;
        extra.parseClassDeclaration = parseClassDeclaration;
        extra.parseClassExpression = parseClassExpression;
        extra.parseClassBody = parseClassBody;
        parseArrayInitialiser = wrapTracking(extra.parseArrayInitialiser);
        parseAssignmentExpression = wrapTracking(extra.parseAssignmentExpression);
        parseBinaryExpression = wrapTracking(extra.parseBinaryExpression);
        parseBlock = wrapTracking(extra.parseBlock);
        parseFunctionSourceElements = wrapTracking(extra.parseFunctionSourceElements);
        parseCatchClause = wrapTracking(extra.parseCatchClause);
        parseComputedMember = wrapTracking(extra.parseComputedMember);
        parseConditionalExpression = wrapTracking(extra.parseConditionalExpression);
        parseConstLetDeclaration = wrapTracking(extra.parseConstLetDeclaration);
        parseExportBatchSpecifier = wrapTracking(parseExportBatchSpecifier);
        parseExportDeclaration = wrapTracking(parseExportDeclaration);
        parseExportSpecifier = wrapTracking(parseExportSpecifier);
        parseExpression = wrapTracking(extra.parseExpression);
        parseForVariableDeclaration = wrapTracking(extra.parseForVariableDeclaration);
        parseFunctionDeclaration = wrapTracking(extra.parseFunctionDeclaration);
        parseFunctionExpression = wrapTracking(extra.parseFunctionExpression);
        parseParams = wrapTracking(extra.parseParams);
        parseImportDeclaration = wrapTracking(extra.parseImportDeclaration);
        parseImportSpecifier = wrapTracking(extra.parseImportSpecifier);
        parseModuleDeclaration = wrapTracking(extra.parseModuleDeclaration);
        parseModuleBlock = wrapTracking(extra.parseModuleBlock);
        parseLeftHandSideExpression = wrapTracking(parseLeftHandSideExpression);
        parseNewExpression = wrapTracking(extra.parseNewExpression);
        parseNonComputedProperty = wrapTracking(extra.parseNonComputedProperty);
        parseObjectInitialiser = wrapTracking(extra.parseObjectInitialiser);
        parseObjectProperty = wrapTracking(extra.parseObjectProperty);
        parseObjectPropertyKey = wrapTracking(extra.parseObjectPropertyKey);
        parsePostfixExpression = wrapTracking(extra.parsePostfixExpression);
        parsePrimaryExpression = wrapTracking(extra.parsePrimaryExpression);
        parseProgram = wrapTracking(extra.parseProgram);
        parsePropertyFunction = wrapTracking(extra.parsePropertyFunction);
        parseTemplateElement = wrapTracking(extra.parseTemplateElement);
        parseTemplateLiteral = wrapTracking(extra.parseTemplateLiteral);
        parseSpreadOrAssignmentExpression = wrapTracking(extra.parseSpreadOrAssignmentExpression);
        parseStatement = wrapTracking(extra.parseStatement);
        parseSwitchCase = wrapTracking(extra.parseSwitchCase);
        parseUnaryExpression = wrapTracking(extra.parseUnaryExpression);
        parseVariableDeclaration = wrapTracking(extra.parseVariableDeclaration);
        parseVariableIdentifier = wrapTracking(extra.parseVariableIdentifier);
        parseMethodDefinition = wrapTracking(extra.parseMethodDefinition);
        parseClassDeclaration = wrapTracking(extra.parseClassDeclaration);
        parseClassExpression = wrapTracking(extra.parseClassExpression);
        parseClassBody = wrapTracking(extra.parseClassBody);
    }
    if (typeof extra.tokens !== 'undefined') {
        extra.advance = advance;
        extra.scanRegExp = scanRegExp;
        advance = collectToken;
        scanRegExp = collectRegex;
    }
}
function unpatch() {
    if (typeof extra.skipComment === 'function') {
        skipComment = extra.skipComment;
    }
    if (extra.range || extra.loc) {
        parseArrayInitialiser = extra.parseArrayInitialiser;
        parseAssignmentExpression = extra.parseAssignmentExpression;
        parseBinaryExpression = extra.parseBinaryExpression;
        parseBlock = extra.parseBlock;
        parseFunctionSourceElements = extra.parseFunctionSourceElements;
        parseCatchClause = extra.parseCatchClause;
        parseComputedMember = extra.parseComputedMember;
        parseConditionalExpression = extra.parseConditionalExpression;
        parseConstLetDeclaration = extra.parseConstLetDeclaration;
        parseExportBatchSpecifier = extra.parseExportBatchSpecifier;
        parseExportDeclaration = extra.parseExportDeclaration;
        parseExportSpecifier = extra.parseExportSpecifier;
        parseExpression = extra.parseExpression;
        parseForVariableDeclaration = extra.parseForVariableDeclaration;
        parseFunctionDeclaration = extra.parseFunctionDeclaration;
        parseFunctionExpression = extra.parseFunctionExpression;
        parseImportDeclaration = extra.parseImportDeclaration;
        parseImportSpecifier = extra.parseImportSpecifier;
        parseGroupExpression = extra.parseGroupExpression;
        parseLeftHandSideExpression = extra.parseLeftHandSideExpression;
        parseLeftHandSideExpressionAllowCall = extra.parseLeftHandSideExpressionAllowCall;
        parseModuleDeclaration = extra.parseModuleDeclaration;
        parseModuleBlock = extra.parseModuleBlock;
        parseNewExpression = extra.parseNewExpression;
        parseNonComputedProperty = extra.parseNonComputedProperty;
        parseObjectInitialiser = extra.parseObjectInitialiser;
        parseObjectProperty = extra.parseObjectProperty;
        parseObjectPropertyKey = extra.parseObjectPropertyKey;
        parsePostfixExpression = extra.parsePostfixExpression;
        parsePrimaryExpression = extra.parsePrimaryExpression;
        parseProgram = extra.parseProgram;
        parsePropertyFunction = extra.parsePropertyFunction;
        parseTemplateElement = extra.parseTemplateElement;
        parseTemplateLiteral = extra.parseTemplateLiteral;
        parseSpreadOrAssignmentExpression = extra.parseSpreadOrAssignmentExpression;
        parseStatement = extra.parseStatement;
        parseSwitchCase = extra.parseSwitchCase;
        parseUnaryExpression = extra.parseUnaryExpression;
        parseVariableDeclaration = extra.parseVariableDeclaration;
        parseVariableIdentifier = extra.parseVariableIdentifier;
        parseMethodDefinition = extra.parseMethodDefinition;
        parseClassDeclaration = extra.parseClassDeclaration;
        parseClassExpression = extra.parseClassExpression;
        parseClassBody = extra.parseClassBody;
    }
    if (typeof extra.scanRegExp === 'function') {
        advance = extra.advance;
        scanRegExp = extra.scanRegExp;
    }
}
// This is used to modify the delegate.
function extend(object, properties) {
    var entry, result = {};
    for (entry in object) {
        if (object.hasOwnProperty(entry)) {
            result[entry] = object[entry];
        }
    }
    for (entry in properties) {
        if (properties.hasOwnProperty(entry)) {
            result[entry] = properties[entry];
        }
    }
    return result;
}
function tokenize(code, options) {
    var toString, token, tokens;
    toString = String;
    if (typeof code !== 'string' && !(code instanceof String)) {
        code = toString(code);
    }
    delegate = SyntaxTreeDelegate;
    source = code;
    index = 0;
    lineNumber = source.length > 0 ? 1 : 0;
    lineStart = 0;
    length = source.length;
    lookahead = null;
    state = {
        allowKeyword: true,
        allowIn: true,
        labelSet: {},
        inFunctionBody: false,
        inIteration: false,
        inSwitch: false
    };
    extra = {};
    // Options matching.
    options = options || {};
    // Of course we collect tokens here.
    options.tokens = true;
    extra.tokens = [];
    extra.tokenize = true;
    // The following two fields are necessary to compute the Regex tokens.
    extra.openParenToken = -1;
    extra.openCurlyToken = -1;
    extra.range = typeof options.range === 'boolean' && options.range;
    extra.loc = typeof options.loc === 'boolean' && options.loc;
    if (typeof options.comment === 'boolean' && options.comment) {
        extra.comments = [];
    }
    if (typeof options.tolerant === 'boolean' && options.tolerant) {
        extra.errors = [];
    }
    if (length > 0) {
        if (typeof source[0] === 'undefined') {
            // Try first to convert to a string. This is good as fast path
            // for old IE which understands string indexing for string
            // literals only and not for string object.
            if (code instanceof String) {
                source = code.valueOf();
            }
        }
    }
    patch();
    try {
        peek();
        if (lookahead.type === Token.EOF) {
            return extra.tokens;
        }
        token = lex();
        while (lookahead.type !== Token.EOF) {
            try {
                token = lex();
            } catch (lexError) {
                token = lookahead;
                if (extra.errors) {
                    extra.errors.push(lexError);
                    // We have to break on the first error
                    // to avoid infinite loops.
                    break;
                } else {
                    throw lexError;
                }
            }
        }
        filterTokenLocation();
        tokens = extra.tokens;
        if (typeof extra.comments !== 'undefined') {
            filterCommentLocation();
            tokens.comments = extra.comments;
        }
        if (typeof extra.errors !== 'undefined') {
            tokens.errors = extra.errors;
        }
    } catch (e) {
        throw e;
    } finally {
        unpatch();
        extra = {};
    }
    return tokens;
}
// Determines if the {} delimiter is a block or an expression.
function blockAllowed(toks, start, inExprDelim, parentIsBlock) {
    var assignOps = [
            '=',
            '+=',
            '-=',
            '*=',
            '/=',
            '%=',
            '<<=',
            '>>=',
            '>>>=',
            '&=',
            '|=',
            '^=',
            ','
        ];
    var binaryOps = [
            '+',
            '-',
            '*',
            '/',
            '%',
            '<<',
            '>>',
            '>>>',
            '&',
            '|',
            '^',
            '&&',
            '||',
            '?',
            ':',
            '===',
            '==',
            '>=',
            '<=',
            '<',
            '>',
            '!=',
            '!==',
            'instanceof'
        ];
    var unaryOps = [
            '++',
            '--',
            '~',
            '!',
            'delete',
            'void',
            'typeof',
            'yield',
            'throw',
            'new'
        ];
    function back(n) {
        var idx = toks.length - n > 0 ? toks.length - n : 0;
        return toks[idx];
    }
    if (inExprDelim && toks.length - (start + 2) <= 0) {
        // ... ({...} ...)
        return false;
    } else if (back(start + 2).value === ':' && parentIsBlock) {
        // ...{a:{b:{...}}}
        return true;
    } else if (isIn(back(start + 2).value, unaryOps.concat(binaryOps).concat(assignOps))) {
        // ... + {...}
        return false;
    } else if (back(start + 2).value === 'return') {
        // ASI makes `{}` a block in:
        //
        //    return
        //    { ... }
        //
        // otherwise an object literal, so it's an
        // expression and thus / is divide
        var currLineNumber = typeof back(start + 1).startLineNumber !== 'undefined' ? back(start + 1).startLineNumber : back(start + 1).lineNumber;
        if (back(start + 2).lineNumber !== currLineNumber) {
            return true;
        } else {
            return false;
        }
    } else if (isIn(back(start + 2).value, [
            'void',
            'typeof',
            'in',
            'case',
            'delete'
        ])) {
        // ... in {}
        return false;
    } else {
        return true;
    }
}
// Readtables
var readtables = {
        currentReadtable: {},
        queued: [],
        punctuators: ';,.:!?~=%&*+-/<>^|#@',
        has: function (ch) {
            return readtables.currentReadtable[ch] && readtables.punctuators.indexOf(ch) !== -1;
        },
        getQueued: function () {
            return readtables.queued.length ? readtables.queued.shift() : null;
        },
        peekQueued: function (lookahead$2) {
            lookahead$2 = lookahead$2 ? lookahead$2 : 1;
            return readtables.queued.length ? readtables.queued[lookahead$2 - 1] : null;
        },
        invoke: function (ch, toks) {
            var prevState = snapshotParserState();
            var newStream = readtables.currentReadtable[ch](ch, readtables.readerAPI, toks, source, index);
            if (!newStream) {
                // Reset the state
                restoreParserState(prevState);
                return null;
            } else if (!Array.isArray(newStream)) {
                newStream = [newStream];
            }
            this.queued = this.queued.concat(newStream);
            return this.getQueued();
        }
    };
function snapshotParserState() {
    return {
        index: index,
        lineNumber: lineNumber,
        lineStart: lineStart
    };
}
function restoreParserState(prevState) {
    index = prevState.index;
    lineNumber = prevState.lineNumber;
    lineStart = prevState.lineStart;
}
function suppressReadError(func) {
    var prevState = snapshotParserState();
    try {
        return func();
    } catch (e) {
        var msg = e.message.toLowerCase();
        if (msg.indexOf('unexpected token') !== -1 || msg.indexOf('assert') !== -1) {
            restoreParserState(prevState);
            return null;
        }
        throw e;
    }
}
function makeIdentifier(value, opts) {
    opts = opts || {};
    var type = Token.Identifier;
    if (isKeyword(value)) {
        type = Token.Keyword;
    } else if (value === 'null') {
        type = Token.NullLiteral;
    } else if (value === 'true' || value === 'false') {
        type = Token.BooleanLiteral;
    }
    return {
        type: type,
        value: value,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            opts.start || index,
            index
        ]
    };
}
function makePunctuator(value, opts) {
    opts = opts || {};
    return {
        type: Token.Punctuator,
        value: value,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            opts.start || index,
            index
        ]
    };
}
function makeStringLiteral(value, opts) {
    opts = opts || {};
    return {
        type: Token.StringLiteral,
        value: value,
        octal: !!opts.octal,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            opts.start || index,
            index
        ]
    };
}
function makeNumericLiteral(value, opts) {
    opts = opts || {};
    return {
        type: Token.NumericLiteral,
        value: value,
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            opts.start || index,
            index
        ]
    };
}
function makeRegExp(value, opts) {
    opts = opts || {};
    return {
        type: Token.RegularExpression,
        value: value,
        literal: value.toString(),
        lineNumber: lineNumber,
        lineStart: lineStart,
        range: [
            opts.start || index,
            index
        ]
    };
}
function makeDelimiter(value, inner) {
    var current = {
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [
                index,
                index
            ]
        };
    var firstTok = inner.length ? inner[0] : current;
    var lastTok = inner.length ? inner[inner.length - 1] : current;
    return {
        type: Token.Delimiter,
        value: value,
        inner: inner,
        startLineNumber: firstTok.lineNumber,
        startLineStart: firstTok.lineStart,
        startRange: firstTok.range,
        endLineNumber: lastTok.lineNumber,
        endLineStart: lastTok.lineStart,
        endRange: lastTok.range
    };
}
// Since an actual parser object doesn't exist and we want to
// introduce our own API anyway, we create a special reader object
// for reader extensions
var readerAPI = {
        Token: Token,
        get source() {
            return source;
        },
        get index() {
            return index;
        },
        set index(x) {
            index = x;
        },
        get length() {
            return length;
        },
        set length(x) {
            length = x;
        },
        get lineNumber() {
            return lineNumber;
        },
        set lineNumber(x) {
            lineNumber = x;
        },
        get lineStart() {
            return lineStart;
        },
        set lineStart(x) {
            lineStart = x;
        },
        get extra() {
            return extra;
        },
        isIdentifierStart: isIdentifierStart,
        isIdentifierPart: isIdentifierPart,
        isLineTerminator: isLineTerminator,
        readIdentifier: scanIdentifier,
        readPunctuator: scanPunctuator,
        readStringLiteral: scanStringLiteral,
        readNumericLiteral: scanNumericLiteral,
        readRegExp: scanRegExp,
        readToken: function () {
            return readToken([], false, false);
        },
        readDelimiter: function () {
            return readDelim([], false, false);
        },
        skipComment: scanComment,
        makeIdentifier: makeIdentifier,
        makePunctuator: makePunctuator,
        makeStringLiteral: makeStringLiteral,
        makeNumericLiteral: makeNumericLiteral,
        makeRegExp: makeRegExp,
        makeDelimiter: makeDelimiter,
        suppressReadError: suppressReadError,
        peekQueued: readtables.peekQueued,
        getQueued: readtables.getQueued
    };
readtables.readerAPI = readerAPI;
// Read the next token. Takes the previously read tokens, a
// boolean indicating if the parent delimiter is () or [], and a
// boolean indicating if the parent delimiter is {} a block
function readToken(toks, inExprDelim, parentIsBlock) {
    var delimiters = [
            '(',
            '{',
            '['
        ];
    var parenIdents = [
            'if',
            'while',
            'for',
            'with'
        ];
    var last = toks.length - 1;
    var comments, commentsLen = extra.comments.length;
    function back(n) {
        var idx = toks.length - n > 0 ? toks.length - n : 0;
        return toks[idx];
    }
    function attachComments(token) {
        if (comments) {
            token.leadingComments = comments;
        }
        return token;
    }
    function _advance() {
        return attachComments(advance());
    }
    function _scanRegExp() {
        return attachComments(scanRegExp());
    }
    skipComment();
    var ch = source[index];
    if (extra.comments.length > commentsLen) {
        comments = extra.comments.slice(commentsLen);
    }
    if (isIn(source[index], delimiters)) {
        return attachComments(readDelim(toks, inExprDelim, parentIsBlock));
    }
    // Check if we should get the token from the readtable
    var readtableToken;
    if ((readtableToken = readtables.getQueued()) || readtables.has(ch) && (readtableToken = readtables.invoke(ch, toks))) {
        return readtableToken;
    }
    if (ch === '/') {
        var prev = back(1);
        if (prev) {
            if (prev.value === '()') {
                if (isIn(back(2).value, parenIdents)) {
                    // ... if (...) / ...
                    return _scanRegExp();
                }
                // ... (...) / ...
                return _advance();
            }
            if (prev.value === '{}') {
                if (blockAllowed(toks, 0, inExprDelim, parentIsBlock)) {
                    if (back(2).value === '()') {
                        // named function
                        if (back(4).value === 'function') {
                            if (!blockAllowed(toks, 3, inExprDelim, parentIsBlock)) {
                                // new function foo (...) {...} / ...
                                return _advance();
                            }
                            if (toks.length - 5 <= 0 && inExprDelim) {
                                // (function foo (...) {...} /...)
                                // [function foo (...) {...} /...]
                                return _advance();
                            }
                        }
                        // unnamed function
                        if (back(3).value === 'function') {
                            if (!blockAllowed(toks, 2, inExprDelim, parentIsBlock)) {
                                // new function (...) {...} / ...
                                return _advance();
                            }
                            if (toks.length - 4 <= 0 && inExprDelim) {
                                // (function (...) {...} /...)
                                // [function (...) {...} /...]
                                return _advance();
                            }
                        }
                    }
                    // ...; {...} /...
                    return _scanRegExp();
                } else {
                    // ... + {...} / ...
                    return _advance();
                }
            }
            if (prev.type === Token.Punctuator) {
                // ... + /...
                return _scanRegExp();
            }
            if (isKeyword(prev.value) && prev.value !== 'this' && prev.value !== 'let' && prev.value !== 'export') {
                // typeof /...
                return _scanRegExp();
            }
            return _advance();
        }
        return _scanRegExp();
    }
    return _advance();
}
function readDelim(toks, inExprDelim, parentIsBlock) {
    var startDelim = advance(), matchDelim = {
            '(': ')',
            '{': '}',
            '[': ']'
        }, inner = [];
    var delimiters = [
            '(',
            '{',
            '['
        ];
    assert(delimiters.indexOf(startDelim.value) !== -1, 'Need to begin at the delimiter');
    var token = startDelim;
    var startLineNumber = token.lineNumber;
    var startLineStart = token.lineStart;
    var startRange = token.range;
    var delimToken = {};
    delimToken.type = Token.Delimiter;
    delimToken.value = startDelim.value + matchDelim[startDelim.value];
    delimToken.startLineNumber = startLineNumber;
    delimToken.startLineStart = startLineStart;
    delimToken.startRange = startRange;
    var delimIsBlock = false;
    if (startDelim.value === '{') {
        delimIsBlock = blockAllowed(toks.concat(delimToken), 0, inExprDelim, parentIsBlock);
    }
    while (index <= length) {
        token = readToken(inner, startDelim.value === '(' || startDelim.value === '[', delimIsBlock);
        if (token.type === Token.Punctuator && token.value === matchDelim[startDelim.value]) {
            if (token.leadingComments) {
                delimToken.trailingComments = token.leadingComments;
            }
            break;
        } else if (token.type === Token.EOF) {
            throwError({}, Messages.UnexpectedEOS);
        } else {
            inner.push(token);
        }
    }
    // at the end of the stream but the very last char wasn't the closing delimiter
    if (index >= length && matchDelim[startDelim.value] !== source[length - 1]) {
        throwError({}, Messages.UnexpectedEOS);
    }
    var endLineNumber = token.lineNumber;
    var endLineStart = token.lineStart;
    var endRange = token.range;
    delimToken.inner = inner;
    delimToken.endLineNumber = endLineNumber;
    delimToken.endLineStart = endLineStart;
    delimToken.endRange = endRange;
    return delimToken;
}
function setReadtable(readtable, syn) {
    readtables.currentReadtable = readtable;
    if (syn) {
        readtables.readerAPI.throwSyntaxError = function (name, message, tok) {
            var sx = syn.syntaxFromToken(tok);
            var err = new syn.MacroSyntaxError(name, message, sx);
            throw new SyntaxError(syn.printSyntaxError(source, err));
        };
    }
}
function currentReadtable() {
    return readtables.currentReadtable;
}
// (Str) -> [...CSyntax]
function read(code) {
    var token, tokenTree = [];
    extra = {};
    extra.comments = [];
    patch();
    source = code;
    index = 0;
    lineNumber = source.length > 0 ? 1 : 0;
    lineStart = 0;
    length = source.length;
    state = {
        allowIn: true,
        labelSet: {},
        lastParenthesized: null,
        inFunctionBody: false,
        inIteration: false,
        inSwitch: false
    };
    while (index < length || readtables.peekQueued()) {
        tokenTree.push(readToken(tokenTree, false, false));
    }
    var last = tokenTree[tokenTree.length - 1];
    if (last && last.type !== Token.EOF) {
        tokenTree.push({
            type: Token.EOF,
            value: '',
            lineNumber: last.lineNumber,
            lineStart: last.lineStart,
            range: [
                index,
                index
            ]
        });
    }
    return expander.tokensToSyntax(tokenTree);
}
function parse(code, options) {
    var program, toString;
    extra = {};
    // given an array of tokens instead of a string
    if (Array.isArray(code)) {
        tokenStream = code;
        length = tokenStream.length;
        lineNumber = tokenStream.length > 0 ? 1 : 0;
        source = undefined;
    } else {
        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }
        source = code;
        length = source.length;
        lineNumber = source.length > 0 ? 1 : 0;
    }
    delegate = SyntaxTreeDelegate;
    streamIndex = -1;
    index = 0;
    lineStart = 0;
    sm_lineStart = 0;
    sm_lineNumber = lineNumber;
    sm_index = 0;
    sm_range = [
        0,
        0
    ];
    lookahead = null;
    state = {
        allowKeyword: false,
        allowIn: true,
        labelSet: {},
        parenthesizedCount: 0,
        inFunctionBody: false,
        inIteration: false,
        inSwitch: false,
        yieldAllowed: false,
        yieldFound: false
    };
    if (typeof options !== 'undefined') {
        extra.range = typeof options.range === 'boolean' && options.range;
        extra.loc = typeof options.loc === 'boolean' && options.loc;
        if (extra.loc && options.source !== null && options.source !== undefined) {
            delegate = extend(delegate, {
                'postProcess': function (node) {
                    node.loc.source = toString(options.source);
                    return node;
                }
            });
        }
        if (typeof options.tokens === 'boolean' && options.tokens) {
            extra.tokens = [];
        }
        if (typeof options.comment === 'boolean' && options.comment) {
            extra.comments = [];
        }
        if (typeof options.tolerant === 'boolean' && options.tolerant) {
            extra.errors = [];
        }
    }
    if (length > 0) {
        if (source && typeof source[0] === 'undefined') {
            // Try first to convert to a string. This is good as fast path
            // for old IE which understands string indexing for string
            // literals only and not for string object.
            if (code instanceof String) {
                source = code.valueOf();
            }
        }
    }
    extra = {
        loc: true,
        errors: []
    };
    patch();
    try {
        program = parseProgram();
        if (typeof extra.comments !== 'undefined') {
            filterCommentLocation();
            program.comments = extra.comments;
        }
        if (typeof extra.tokens !== 'undefined') {
            filterTokenLocation();
            program.tokens = extra.tokens;
        }
        if (typeof extra.errors !== 'undefined') {
            program.errors = extra.errors;
        }
        if (extra.range || extra.loc) {
            program.body = filterGroup(program.body);
        }
    } catch (e) {
        throw e;
    } finally {
        unpatch();
        extra = {};
    }
    return program;
}
exports.tokenize = tokenize;
exports.read = read;
exports.Token = Token;
exports.setReadtable = setReadtable;
exports.currentReadtable = currentReadtable;
exports.parse = parse;
// Deep copy.
exports.Syntax = function () {
    var name, types = {};
    if (typeof Object.create === 'function') {
        types = Object.create(null);
    }
    for (name in Syntax) {
        if (Syntax.hasOwnProperty(name)) {
            types[name] = Syntax[name];
        }
    }
    if (typeof Object.freeze === 'function') {
        Object.freeze(types);
    }
    return types;
}();
//# sourceMappingURL=parser.js.map
},{"./expander":1}],3:[function(_dereq_,module,exports){
'use strict';
var _ = _dereq_('underscore');
var parser = _dereq_('./parser');
var expander = _dereq_('./expander');
var syntax = _dereq_('./syntax');
var get_expression = expander.get_expression;
var syntaxFromToken = syntax.syntaxFromToken;
var makePunc = syntax.makePunc;
var makeIdent = syntax.makeIdent;
var makeDelim = syntax.makeDelim;
var joinSyntax = syntax.joinSyntax;
var joinSyntaxArray = syntax.joinSyntaxArray;
var cloneSyntaxArray = syntax.cloneSyntaxArray;
var assert = syntax.assert;
var throwSyntaxError = syntax.throwSyntaxError;
var push = Array.prototype.push;
// ([...CSyntax]) -> [...Str]
function freeVarsInPattern(pattern) {
    var fv = [];
    _.each(pattern, function (pat) {
        if (isPatternVar(pat)) {
            fv.push(pat.token.value);
        } else if (pat.token.type === parser.Token.Delimiter) {
            push.apply(fv, freeVarsInPattern(pat.token.inner));
        }
    });
    return fv;
}
function typeIsLiteral(type) {
    return type === parser.Token.NullLiteral || type === parser.Token.NumericLiteral || type === parser.Token.StringLiteral || type === parser.Token.RegexLiteral || type === parser.Token.BooleanLiteral;
}
function containsPatternVar(patterns) {
    return _.any(patterns, function (pat) {
        if (pat.token.type === parser.Token.Delimiter) {
            return containsPatternVar(pat.token.inner);
        }
        return isPatternVar(pat);
    });
}
function delimIsSeparator(delim) {
    return delim && delim.token && delim.token.type === parser.Token.Delimiter && delim.token.value === '()' && delim.token.inner.length === 1 && delim.token.inner[0].token.type !== parser.Token.Delimiter && !containsPatternVar(delim.token.inner);
}
function isPatternVar(stx) {
    return stx.token.value[0] === '$' && stx.token.value !== '$';
}
// ([...{level: Num, match: [...CSyntax]}], Str) -> [...CSyntax]
function joinRepeatedMatch(tojoin, punc) {
    return _.reduce(_.rest(tojoin, 1), function (acc, join) {
        if (punc === ' ') {
            return acc.concat(cloneSyntaxArray(join.match));
        }
        return acc.concat(makePunc(punc, _.first(join.match)), cloneSyntaxArray(join.match));
    }, cloneSyntaxArray(_.first(tojoin).match));
}
// take the line context (range, lineNumber)
// (CSyntax, [...CSyntax]) -> [...CSyntax]
function takeLineContext(from, to) {
    return _.map(to, function (stx) {
        return takeLine(from, stx);
    });
}
// (CSyntax, CSyntax) -> CSyntax
function takeLine(from, to) {
    var next;
    if (to.token.type === parser.Token.Delimiter) {
        var sm_startLineNumber = typeof to.token.sm_startLineNumber !== 'undefined' ? to.token.sm_startLineNumber : to.token.startLineNumber;
        var sm_endLineNumber = typeof to.token.sm_endLineNumber !== 'undefined' ? to.token.sm_endLineNumber : to.token.endLineNumber;
        var sm_startLineStart = typeof to.token.sm_startLineStart !== 'undefined' ? to.token.sm_startLineStart : to.token.startLineStart;
        var sm_endLineStart = typeof to.token.sm_endLineStart !== 'undefined' ? to.token.sm_endLineStart : to.token.endLineStart;
        var sm_startRange = typeof to.token.sm_startRange !== 'undefined' ? to.token.sm_startRange : to.token.startRange;
        var sm_endRange = typeof to.token.sm_endRange !== 'undefined' ? to.token.sm_endRange : to.token.endRange;
        if (from.token.type === parser.Token.Delimiter) {
            next = syntaxFromToken({
                type: parser.Token.Delimiter,
                value: to.token.value,
                inner: takeLineContext(from, to.token.inner),
                startRange: from.token.startRange,
                endRange: from.token.endRange,
                startLineNumber: from.token.startLineNumber,
                startLineStart: from.token.startLineStart,
                endLineNumber: from.token.endLineNumber,
                endLineStart: from.token.endLineStart,
                sm_startLineNumber: sm_startLineNumber,
                sm_endLineNumber: sm_endLineNumber,
                sm_startLineStart: sm_startLineStart,
                sm_endLineStart: sm_endLineStart,
                sm_startRange: sm_startRange,
                sm_endRange: sm_endRange
            }, to);
        } else {
            next = syntaxFromToken({
                type: parser.Token.Delimiter,
                value: to.token.value,
                inner: takeLineContext(from, to.token.inner),
                startRange: from.token.range,
                endRange: from.token.range,
                startLineNumber: from.token.lineNumber,
                startLineStart: from.token.lineStart,
                endLineNumber: from.token.lineNumber,
                endLineStart: from.token.lineStart,
                sm_startLineNumber: sm_startLineNumber,
                sm_endLineNumber: sm_endLineNumber,
                sm_startLineStart: sm_startLineStart,
                sm_endLineStart: sm_endLineStart,
                sm_startRange: sm_startRange,
                sm_endRange: sm_endRange
            }, to);
        }
    } else {
        var sm_lineNumber = typeof to.token.sm_lineNumber !== 'undefined' ? to.token.sm_lineNumber : to.token.lineNumber;
        var sm_lineStart = typeof to.token.sm_lineStart !== 'undefined' ? to.token.sm_lineStart : to.token.lineStart;
        var sm_range = typeof to.token.sm_range !== 'undefined' ? to.token.sm_range : to.token.range;
        if (from.token.type === parser.Token.Delimiter) {
            next = syntaxFromToken({
                value: to.token.value,
                type: to.token.type,
                lineNumber: from.token.startLineNumber,
                lineStart: from.token.startLineStart,
                range: from.token.startRange,
                sm_lineNumber: sm_lineNumber,
                sm_lineStart: sm_lineStart,
                sm_range: sm_range
            }, to);
        } else {
            next = syntaxFromToken({
                value: to.token.value,
                type: to.token.type,
                lineNumber: from.token.lineNumber,
                lineStart: from.token.lineStart,
                range: from.token.range,
                sm_lineNumber: sm_lineNumber,
                sm_lineStart: sm_lineStart,
                sm_range: sm_range
            }, to);
        }
    }
    if (to.token.leadingComments) {
        next.token.leadingComments = to.token.leadingComments;
    }
    if (to.token.trailingComments) {
        next.token.trailingComments = to.token.trailingComments;
    }
    return next;
}
function reversePattern(patterns) {
    var len = patterns.length;
    var pat;
    return _.reduceRight(patterns, function (acc, pat$2) {
        if (pat$2.class === 'pattern_group' || pat$2.class === 'named_group') {
            pat$2.inner = reversePattern(pat$2.inner);
        }
        if (pat$2.repeat) {
            pat$2.leading = !pat$2.leading;
        }
        acc.push(pat$2);
        return acc;
    }, []);
}
function loadLiteralGroup(patterns) {
    return patterns.map(function (patStx) {
        var pat = patternToObject(patStx);
        if (pat.inner) {
            pat.inner = loadLiteralGroup(pat.inner);
        } else {
            pat.class = 'pattern_literal';
        }
        return pat;
    });
}
function patternToObject(pat) {
    var obj = {
            type: pat.token.type,
            value: pat.token.value
        };
    if (pat.token.inner) {
        obj.inner = pat.token.inner;
    }
    return obj;
}
function isPrimaryClass(name) {
    return [
        'expr',
        'lit',
        'ident',
        'token',
        'invoke',
        'invokeRec'
    ].indexOf(name) > -1;
}
function loadPattern(patterns, reverse) {
    var patts = [];
    for (var i = 0; i < patterns.length; i++) {
        var tok1 = patterns[i];
        var tok2 = patterns[i + 1];
        var tok3 = patterns[i + 2];
        var tok4 = patterns[i + 3];
        var last = patts[patts.length - 1];
        var patt;
        assert(tok1, 'Expecting syntax object');
        // Repeaters
        if (tok1.token.type === parser.Token.Delimiter && tok1.token.value === '()' && tok2 && tok2.token.type === parser.Token.Punctuator && tok2.token.value === '...' && last) {
            assert(tok1.token.inner.length === 1, 'currently assuming all separators are a single token');
            i += 1;
            last.repeat = true;
            last.separator = tok1.token.inner[0].token.value;
            continue;
        } else if (tok1.token.type === parser.Token.Punctuator && tok1.token.value === '...' && last) {
            last.repeat = true;
            last.separator = ' ';
            continue;
        } else if (isPatternVar(tok1)) {
            patt = patternToObject(tok1);
            if (tok2 && tok2.token.type === parser.Token.Punctuator && tok2.token.value === ':' && tok3 && (tok3.token.type === parser.Token.Identifier || tok3.token.type === parser.Token.Delimiter && (tok3.token.value === '[]' || tok3.token.value === '()'))) {
                i += 2;
                if (tok3.token.value === '[]') {
                    patt.class = 'named_group';
                    patt.inner = loadLiteralGroup(tok3.expose().token.inner);
                } else if (tok3.token.value === '()') {
                    patt.class = 'named_group';
                    patt.inner = loadPattern(tok3.expose().token.inner);
                } else if (isPrimaryClass(tok3.token.value)) {
                    patt.class = tok3.token.value;
                    if (patt.class === 'invokeRec' || patt.class === 'invoke') {
                        i += 1;
                        if (tok4.token.value === '()' && tok4.token.inner.length) {
                            patt.macroName = tok4.expose().token.inner;
                        } else {
                            throwSyntaxError(patt.class, 'Expected macro parameter', tok3);
                        }
                    }
                } else {
                    patt.class = 'invoke';
                    patt.macroName = [tok3];
                }
            } else {
                patt.class = 'token';
            }
        } else if (tok1.token.type === parser.Token.Identifier && tok1.token.value === '$' && tok2.token.type === parser.Token.Delimiter) {
            i += 1;
            patt = patternToObject(tok2);
            patt.class = 'pattern_group';
            if (patt.value === '[]') {
                patt.inner = loadLiteralGroup(patt.inner);
            } else {
                patt.inner = loadPattern(tok2.expose().token.inner);
            }
        } else if (tok1.token.type === parser.Token.Identifier && tok1.token.value === '_') {
            patt = patternToObject(tok1);
            patt.class = 'wildcard';
        } else {
            patt = patternToObject(tok1);
            patt.class = 'pattern_literal';
            if (patt.inner) {
                patt.inner = loadPattern(tok1.expose().token.inner);
            }
        }
        // Macro classes aren't allowed in lookbehind because we wouldn't
        // know where to insert the macro, and you can't use a L->R macro
        // to match R->L.
        if (reverse && patt.macroName) {
            throwSyntaxError(patt.class, 'Not allowed in top-level lookbehind', patt.macroName[0]);
        }
        patts.push(patt);
    }
    return reverse ? reversePattern(patts) : patts;
}
function cachedTermMatch(stx, term) {
    var res = [];
    var i = 0;
    while (stx[i] && stx[i].term === term) {
        res.unshift(stx[i]);
        i++;
    }
    return {
        result: term,
        destructed: res,
        rest: stx.slice(res.length)
    };
}
function expandWithMacro(macroName, stx, context, rec) {
    var name = macroName.map(syntax.unwrapSyntax).join('');
    var ident = syntax.makeIdent(name, macroName[0]);
    var macroObj = context.env.get(expander.resolve(ident));
    var newContext = expander.makeExpanderContext(context);
    if (!macroObj) {
        throwSyntaxError('invoke', 'Macro not in scope', macroName[0]);
    }
    var next = macroName.slice(-1).concat(stx);
    var rest, result, rt, patternEnv;
    while (macroObj && next) {
        try {
            rt = macroObj.fn(next, newContext, [], []);
            result = rt.result;
            rest = rt.rest;
            patternEnv = rt.patterns;
        } catch (e) {
            if (e instanceof syntax.SyntaxCaseError) {
                result = null;
                rest = stx;
                break;
            } else {
                throw e;
            }
        }
        if (rec && result.length >= 1) {
            var resultHead = result[0];
            var resultRest = result.slice(1);
            var nextName = expander.getName(resultHead, resultRest);
            var nextMacro = expander.getMacroInEnv(resultHead, resultRest, context.env);
            if (nextName && nextMacro) {
                macroObj = nextMacro;
                next = result.concat(rest);
            } else {
                break;
            }
        } else {
            break;
        }
    }
    return {
        result: result,
        rest: rest,
        patternEnv: patternEnv
    };
}
// (Pattern, [...CSyntax], MacroEnv) -> {result: null or [...CSyntax], rest: [...CSyntax]}
function matchPatternClass(patternObj, stx, context) {
    var result, rest, match, patternEnv;
    // pattern has no parse class
    if (patternObj.class === 'token' && stx[0] && stx[0].token.type !== parser.Token.EOF) {
        result = [stx[0]];
        rest = stx.slice(1);
    } else if (patternObj.class === 'lit' && stx[0] && typeIsLiteral(stx[0].token.type)) {
        result = [stx[0]];
        rest = stx.slice(1);
    } else if (patternObj.class === 'ident' && stx[0] && stx[0].token.type === parser.Token.Identifier) {
        result = [stx[0]];
        rest = stx.slice(1);
    } else if (stx.length > 0 && patternObj.class === 'VariableStatement') {
        match = stx[0].term ? cachedTermMatch(stx, stx[0].term) : expander.enforest(stx, expander.makeExpanderContext(context));
        if (match.result && match.result.isVariableStatement) {
            result = match.destructed || match.result.destruct(false);
            rest = match.rest;
        } else {
            result = null;
            rest = stx;
        }
    } else if (stx.length > 0 && patternObj.class === 'expr') {
        match = expander.get_expression(stx, expander.makeExpanderContext(context));
        if (match.result === null || !match.result.isExpr) {
            result = null;
            rest = stx;
        } else {
            result = match.destructed || match.result.destruct(false);
            result = [syntax.makeDelim('()', result, result[0])];
            rest = match.rest;
        }
    } else if (stx.length > 0 && (patternObj.class === 'invoke' || patternObj.class === 'invokeRec')) {
        match = expandWithMacro(patternObj.macroName, stx, context, patternObj.class === 'invokeRec');
        result = match.result;
        rest = match.result ? match.rest : stx;
        patternEnv = match.patternEnv;
    } else {
        result = null;
        rest = stx;
    }
    return {
        result: result,
        rest: rest,
        patternEnv: patternEnv
    };
}
// attempt to match patterns against stx
// ([...Pattern], [...Syntax], Env) -> { result: [...Syntax], rest: [...Syntax], patternEnv: PatternEnv }
function matchPatterns(patterns, stx, context, topLevel) {
    // topLevel lets us know if the patterns are on the top level or nested inside
    // a delimiter:
    //     case $topLevel (,) ... => { }
    //     case ($nested (,) ...) => { }
    // This matters for how we deal with trailing unmatched syntax when the pattern
    // has an ellipses:
    //     m 1,2,3 foo
    // should match 1,2,3 and leave foo alone but:
    //     m (1,2,3 foo)
    // should fail to match entirely.
    topLevel = topLevel || false;
    // note that there are two environments floating around,
    // one is the mapping of identifiers to macro definitions (env)
    // and the other is the pattern environment (patternEnv) that maps
    // patterns in a macro case to syntax.
    var result = [];
    var patternEnv = {};
    var match;
    var pattern;
    var rest = stx;
    var success = true;
    var inLeading;
    patternLoop:
        for (var i = 0; i < patterns.length; i++) {
            if (success === false) {
                break;
            }
            pattern = patterns[i];
            inLeading = false;
            do {
                // handles cases where patterns trail a repeated pattern like `$x ... ;`
                if (pattern.repeat && i + 1 < patterns.length) {
                    var restMatch = matchPatterns(patterns.slice(i + 1), rest, context, topLevel);
                    if (restMatch.success) {
                        // match the repeat pattern on the empty array to fill in its
                        // pattern variable in the environment
                        match = matchPattern(pattern, [], context, patternEnv, topLevel);
                        patternEnv = _.extend(restMatch.patternEnv, match.patternEnv);
                        rest = restMatch.rest;
                        break patternLoop;
                    }
                }
                if (pattern.repeat && pattern.leading && pattern.separator !== ' ') {
                    if (rest[0].token.value === pattern.separator) {
                        if (!inLeading) {
                            inLeading = true;
                        }
                        rest = rest.slice(1);
                    } else {
                        // If we are in a leading repeat, the separator is required.
                        if (inLeading) {
                            success = false;
                            break;
                        }
                    }
                }
                match = matchPattern(pattern, rest, context, patternEnv, topLevel);
                if (!match.success && pattern.repeat) {
                    // a repeat can match zero tokens and still be a
                    // "success" so break out of the inner loop and
                    // try the next pattern
                    break;
                }
                if (!match.success) {
                    success = false;
                    break;
                }
                rest = match.rest;
                patternEnv = match.patternEnv;
                if (success && !(topLevel || pattern.repeat)) {
                    // the very last pattern matched, inside a
                    // delimiter, not a repeat, *and* there are more
                    // unmatched bits of syntax
                    if (i == patterns.length - 1 && rest.length !== 0) {
                        success = false;
                        break;
                    }
                }
                if (pattern.repeat && !pattern.leading && success) {
                    // if (i < patterns.length - 1 && rest.length > 0) {
                    //     var restMatch = matchPatterns(patterns.slice(i+1), rest, env, topLevel);
                    //     if (restMatch.success) {
                    //         patternEnv = _.extend(patternEnv, restMatch.patternEnv);
                    //         rest = restMatch.rest;
                    //         break patternLoop;
                    //     }
                    // }
                    if (pattern.separator === ' ') {
                        // no separator specified (using the empty string for this)
                        // so keep going
                        continue;
                    } else if (rest[0] && rest[0].token.value === pattern.separator) {
                        // more tokens and the next token matches the separator
                        rest = rest.slice(1);
                    } else if (pattern.separator !== ' ' && rest.length > 0 && i === patterns.length - 1 && topLevel === false) {
                        // separator is specified, there is a next token, the
                        // next token doesn't match the separator, there are
                        // no more patterns, and this is a top level pattern
                        // so the match has failed
                        success = false;
                        break;
                    } else {
                        break;
                    }
                }
            } while (pattern.repeat && success && rest.length > 0);
        }
    // If we are in a delimiter and we haven't matched all the syntax, it
    // was a failed match.
    if (!topLevel && rest.length) {
        success = false;
    }
    var result;
    if (success) {
        result = rest.length ? stx.slice(0, -rest.length) : stx;
    } else {
        result = [];
    }
    return {
        success: success,
        result: result,
        rest: rest,
        patternEnv: patternEnv
    };
}
/* the pattern environment will look something like:
    {
        "$x": {
            level: 2,
            match: [{
                level: 1,
                match: [{
                    level: 0,
                    match: [tok1, tok2, ...]
                }, {
                    level: 0,
                    match: [tok1, tok2, ...]
                }]
            }, {
                level: 1,
                match: [{
                    level: 0,
                    match: [tok1, tok2, ...]
                }]
            }]
        },
        "$y" : ...
    }
    */
function matchPattern(pattern, stx, context, patternEnv, topLevel) {
    var subMatch;
    var match, matchEnv;
    var rest;
    var success;
    if (typeof pattern.inner !== 'undefined') {
        if (pattern.class === 'pattern_group') {
            // pattern groups don't match the delimiters
            subMatch = matchPatterns(pattern.inner, stx, context, true);
            rest = subMatch.rest;
            success = subMatch.success;
        } else if (pattern.class === 'named_group') {
            subMatch = matchPatterns(pattern.inner, stx, context, true);
            rest = subMatch.rest;
            success = subMatch.success;
            if (success) {
                var namedMatch = {};
                namedMatch[pattern.value] = {
                    level: 0,
                    match: subMatch.result,
                    topLevel: topLevel
                };
                subMatch.patternEnv = loadPatternEnv(namedMatch, subMatch.patternEnv, topLevel, false, pattern.value);
            }
        } else if (stx[0] && stx[0].token.type === parser.Token.Delimiter && stx[0].token.value === pattern.value) {
            stx[0].expose();
            if (pattern.inner.length === 0 && stx[0].token.inner.length !== 0) {
                return {
                    success: false,
                    rest: stx,
                    patternEnv: patternEnv
                };
            }
            subMatch = matchPatterns(pattern.inner, stx[0].token.inner, context, false);
            rest = stx.slice(1);
            success = subMatch.success;
        } else {
            subMatch = matchPatterns(pattern.inner, [], context, false);
            success = false;
        }
        if (success) {
            patternEnv = loadPatternEnv(patternEnv, subMatch.patternEnv, topLevel, pattern.repeat);
        } else if (pattern.repeat) {
            patternEnv = initPatternEnv(patternEnv, subMatch.patternEnv, topLevel);
        }
    } else {
        if (pattern.class === 'wildcard') {
            success = true;
            rest = stx.slice(1);
        } else if (pattern.class === 'pattern_literal') {
            // match the literal but don't update the pattern environment
            if (stx[0] && pattern.value === stx[0].token.value) {
                success = true;
                rest = stx.slice(1);
            } else {
                success = false;
                rest = stx;
            }
        } else {
            match = matchPatternClass(pattern, stx, context);
            success = match.result !== null;
            rest = match.rest;
            matchEnv = {
                level: 0,
                match: match.result,
                topLevel: topLevel
            };
            // push the match onto this value's slot in the environment
            if (pattern.repeat) {
                if (patternEnv[pattern.value] && success) {
                    patternEnv[pattern.value].match.push(matchEnv);
                } else if (patternEnv[pattern.value] === undefined) {
                    // initialize if necessary
                    patternEnv[pattern.value] = {
                        level: 1,
                        match: [matchEnv],
                        topLevel: topLevel
                    };
                }
            } else {
                patternEnv[pattern.value] = matchEnv;
            }
            patternEnv = loadPatternEnv(patternEnv, match.patternEnv, topLevel, pattern.repeat, pattern.value);
        }
    }
    return {
        success: success,
        rest: rest,
        patternEnv: patternEnv
    };
}
function initPatternEnv(toEnv, fromEnv, topLevel) {
    _.forEach(fromEnv, function (patternVal, patternKey) {
        if (!toEnv[patternKey]) {
            toEnv[patternKey] = {
                level: patternVal.level + 1,
                match: [patternVal],
                topLevel: topLevel
            };
        }
    });
    return toEnv;
}
function loadPatternEnv(toEnv, fromEnv, topLevel, repeat, prefix) {
    prefix = prefix || '';
    _.forEach(fromEnv, function (patternVal, patternKey) {
        var patternName = prefix + patternKey;
        if (repeat) {
            var nextLevel = patternVal.level + 1;
            if (toEnv[patternName]) {
                toEnv[patternName].level = nextLevel;
                toEnv[patternName].match.push(patternVal);
            } else {
                toEnv[patternName] = {
                    level: nextLevel,
                    match: [patternVal],
                    topLevel: topLevel
                };
            }
        } else {
            toEnv[patternName] = patternVal;
        }
    });
    return toEnv;
}
function matchLookbehind(patterns, stx, terms, context) {
    var success, patternEnv, prevStx, prevTerms;
    // No lookbehind, noop.
    if (!patterns.length) {
        success = true;
        patternEnv = {};
        prevStx = stx;
        prevTerms = terms;
    } else {
        var match = matchPatterns(patterns, stx, context, true);
        var last = match.result[match.result.length - 1];
        success = match.success;
        patternEnv = match.patternEnv;
        if (success) {
            if (match.rest.length) {
                if (last && last.term && last.term === match.rest[0].term) {
                    // The term tree was split, so its a failed match;
                    success = false;
                } else {
                    prevStx = match.rest;
                    // Find where to slice the prevTerms to match up with
                    // the state of prevStx.
                    for (var i = 0, len = terms.length; i < len; i++) {
                        if (terms[i] === prevStx[0].term) {
                            prevTerms = terms.slice(i);
                            break;
                        }
                    }
                    assert(prevTerms, 'No matching previous term found');
                }
            } else {
                prevTerms = [];
                prevStx = [];
            }
        }
    }
    // We need to reverse the matches for any top level repeaters because
    // they match in reverse, and thus put their results in backwards.
    _.forEach(patternEnv, function (val, key) {
        if (val.level && val.match && val.topLevel) {
            val.match.reverse();
        }
    });
    return {
        success: success,
        patternEnv: patternEnv,
        prevStx: prevStx,
        prevTerms: prevTerms
    };
}
function hasMatch(m) {
    if (m.level === 0) {
        return m.match.length > 0;
    }
    return !!m.match;
}
// given the given the macroBody (list of Pattern syntax objects) and the
// environment (a mapping of patterns to syntax) return the body with the
// appropriate patterns replaces with their value in the environment
function transcribe(macroBody, macroNameStx, env) {
    return _.chain(macroBody).reduce(function (acc, bodyStx, idx, original) {
        // first find the ellipses and mark the syntax objects
        // (note that this step does not eagerly go into delimiter bodies)
        var last = original[idx - 1];
        var next = original[idx + 1];
        var nextNext = original[idx + 2];
        // drop `...`
        if (bodyStx.token.value === '...') {
            return acc;
        }
        // drop `(<separator)` when followed by an ellipse
        if (delimIsSeparator(bodyStx) && next && next.token.value === '...') {
            return acc;
        }
        // skip the $ in $(...)
        if (bodyStx.token.value === '$' && next && next.token.type === parser.Token.Delimiter && next.token.value === '()') {
            return acc;
        }
        // mark $[...] as a literal
        if (bodyStx.token.value === '$' && next && next.token.type === parser.Token.Delimiter && next.token.value === '[]') {
            next.literal = true;
            return acc;
        }
        if (bodyStx.token.type === parser.Token.Delimiter && bodyStx.token.value === '()' && last && last.token.value === '$') {
            bodyStx.group = true;
        }
        // literal [] delimiters have their bodies just
        // directly passed along
        if (bodyStx.literal === true) {
            assert(bodyStx.token.type === parser.Token.Delimiter, 'expecting a literal to be surrounded by []');
            return acc.concat(bodyStx.token.inner);
        }
        if (next && next.token.value === '...') {
            bodyStx.repeat = true;
            bodyStx.separator = ' ';
        }    // default to space separated
        else if (delimIsSeparator(next) && nextNext && nextNext.token.value === '...') {
            bodyStx.repeat = true;
            bodyStx.separator = next.token.inner[0].token.value;
        }
        acc.push(bodyStx);
        return acc;
    }, []).reduce(function (acc, bodyStx, idx) {
        // then do the actual transcription
        if (bodyStx.repeat) {
            if (bodyStx.token.type === parser.Token.Delimiter) {
                bodyStx.expose();
                var fv = _.filter(freeVarsInPattern(bodyStx.token.inner), function (pat) {
                        // ignore "patterns"
                        // that aren't in the
                        // environment (treat
                        // them like literals)
                        return env.hasOwnProperty(pat);
                    });
                var restrictedEnv = [];
                var nonScalar = _.find(fv, function (pat) {
                        return env[pat].level > 0;
                    });
                assert(typeof nonScalar !== 'undefined', 'must have a least one non-scalar in repeat');
                var repeatLength = env[nonScalar].match.length;
                var sameLength = _.all(fv, function (pat) {
                        return env[pat].level === 0 || env[pat].match.length === repeatLength;
                    });
                assert(sameLength, 'all non-scalars must have the same length');
                // create a list of envs restricted to the free vars
                _.each(_.range(repeatLength), function (idx$2) {
                    var renv = {};
                    _.each(fv, function (pat) {
                        if (env[pat].level === 0) {
                            // copy scalars over
                            renv[pat] = env[pat];
                        } else {
                            // grab the match at this index
                            renv[pat] = env[pat].match[idx$2];
                        }
                    });
                    var allHaveMatch = Object.keys(renv).every(function (pat) {
                            return hasMatch(renv[pat]);
                        });
                    if (allHaveMatch) {
                        restrictedEnv.push(renv);
                    }
                });
                var transcribed = _.map(restrictedEnv, function (renv) {
                        if (bodyStx.group) {
                            return transcribe(bodyStx.token.inner, macroNameStx, renv);
                        } else {
                            var newBody$2 = syntaxFromToken(_.clone(bodyStx.token), bodyStx);
                            newBody$2.token.inner = transcribe(bodyStx.token.inner, macroNameStx, renv);
                            return newBody$2;
                        }
                    });
                var joined;
                if (bodyStx.group) {
                    joined = joinSyntaxArray(transcribed, bodyStx.separator);
                } else {
                    joined = joinSyntax(transcribed, bodyStx.separator);
                }
                push.apply(acc, joined);
                return acc;
            }
            if (!env[bodyStx.token.value]) {
                throwSyntaxError('patterns', 'The pattern variable is not bound for the template', bodyStx);
            } else if (env[bodyStx.token.value].level !== 1) {
                throwSyntaxError('patterns', 'Ellipses level does not match in the template', bodyStx);
            }
            push.apply(acc, joinRepeatedMatch(env[bodyStx.token.value].match, bodyStx.separator));
            return acc;
        } else {
            if (bodyStx.token.type === parser.Token.Delimiter) {
                bodyStx.expose();
                var newBody = syntaxFromToken(_.clone(bodyStx.token), macroBody);
                newBody.token.inner = transcribe(bodyStx.token.inner, macroNameStx, env);
                acc.push(newBody);
                return acc;
            }
            if (isPatternVar(bodyStx) && Object.prototype.hasOwnProperty.bind(env)(bodyStx.token.value)) {
                if (!env[bodyStx.token.value]) {
                    throwSyntaxError('patterns', 'The pattern variable is not bound for the template', bodyStx);
                } else if (env[bodyStx.token.value].level !== 0) {
                    throwSyntaxError('patterns', 'Ellipses level does not match in the template', bodyStx);
                }
                push.apply(acc, takeLineContext(bodyStx, env[bodyStx.token.value].match));
                return acc;
            }
            acc.push(syntaxFromToken(_.clone(bodyStx.token), bodyStx));
            return acc;
        }
    }, []).value();
}
function cloneMatch(oldMatch) {
    var newMatch = {
            success: oldMatch.success,
            rest: oldMatch.rest,
            patternEnv: {}
        };
    for (var pat in oldMatch.patternEnv) {
        if (oldMatch.patternEnv.hasOwnProperty(pat)) {
            newMatch.patternEnv[pat] = oldMatch.patternEnv[pat];
        }
    }
    return newMatch;
}
function makeIdentityRule(pattern, isInfix, context) {
    var inf = [];
    var pat = [];
    var stx = [];
    if (isInfix) {
        for (var i = 0; i < pattern.length; i++) {
            if (pattern[i].token.type === parser.Token.Punctuator && pattern[i].token.value === '|') {
                pat.push(makeIdent('$inf', context), makePunc(':', context), makeDelim('()', inf, context), pattern[0], makeIdent('$id', context), makePunc(':', context), makeDelim('()', pat.slice(i + 1), context));
                stx.push(makeIdent('$inf', context), makeIdent('$id', context));
                break;
            }
            inf.push(pattern[i]);
        }
    } else {
        pat.push(makeIdent('$id', context), makePunc(':', context), makeDelim('()', pattern, context));
        stx.push(makeIdent('$id', context));
    }
    return {
        pattern: pat,
        body: stx
    };
}
exports.loadPattern = loadPattern;
exports.matchPatterns = matchPatterns;
exports.matchLookbehind = matchLookbehind;
exports.transcribe = transcribe;
exports.matchPatternClass = matchPatternClass;
exports.takeLineContext = takeLineContext;
exports.takeLine = takeLine;
exports.typeIsLiteral = typeIsLiteral;
exports.cloneMatch = cloneMatch;
exports.makeIdentityRule = makeIdentityRule;
//# sourceMappingURL=patterns.js.map
},{"./expander":1,"./parser":2,"./syntax":6,"underscore":33}],4:[function(_dereq_,module,exports){
// thou shalt not macro expand me...all kinds of hygiene hackary
// with strings and `with`.


(function (root, factory) {
    if (typeof exports === 'object') {
        // CommonJS
        factory(exports);
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['exports'], factory);
    }
}(this, function(exports) {

    exports.scopedEval = function(source, global) {
        return eval('(function() { with(global) { return ' + source + ' } }).call(global, global);');
    };

}));


},{}],5:[function(_dereq_,module,exports){
(function (process){
/*
  Copyright (C) 2012 Tim Disney <tim@disnet.me>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
'use strict';
var path = _dereq_('path');
var fs = _dereq_('fs');
var resolveSync = _dereq_('resolve/lib/sync');
var codegen = _dereq_('escodegen');
// var stxcaseModule = fs.readFileSync(lib + "/stxcase.js", 'utf8');
var stxcaseModule = 'let quoteSyntax = macro {\n    function(stx) {\n        var name_stx = stx[0];\n\n        if (!(stx[1] && stx[1].token && stx[1].token.inner)) {\n            throwSyntaxError("macro", "Macro `quoteSyntax` could not be matched" , stx[1]);\n        }\n\n        var res = [\n            makeIdent("#quoteSyntax", null),\n            stx[1].expose()\n        ];\n\n        return {\n            result: res,\n            rest: stx.slice(2)\n        };\n    }\n}\nexport quoteSyntax\n\nlet syntax = macro {\n    function(stx) {\n        var name_stx = stx[0];\n        var here = quoteSyntax{here};\n        var takeLineContext = patternModule.takeLineContext;\n        var takeLine = patternModule.takeLine;\n        var mod = makeIdent("patternModule", here);\n\n        if (!(stx[1] && stx[1].token && stx[1].token.inner)) {\n            throwSyntaxError("macro", "Macro `syntax` could not be matched", stx[1]);\n        }\n\n        var res = [mod,\n                   makePunc(".", here),\n                   makeIdent("transcribe", here),\n                   makeDelim("()", [\n                       makeIdent("#quoteSyntax", here),\n                       stx[1].expose(),\n                       makePunc(",", here),\n                       // breaking hygiene to capture `name_stx`, `match`, and\n                       // `patternEnv` inside the syntaxCase macro\n                       makeIdent("name_stx", name_stx),\n                       makePunc(",", here),\n                       makeIdent("match", name_stx),\n                       makePunc(".", here),\n                       makeIdent("patternEnv", name_stx)\n                   ], here)];\n\n\n        return {\n            result: res,\n            rest: stx.slice(2)\n        };\n    }\n}\nexport syntax\n\nmacro # {\n    function (stx) {\n        return {\n            // breaking hygiene to capture inside syntaxCase\n            result: [makeIdent("syntax", stx[0]),\n                     stx[1]],\n            rest: stx.slice(2)\n        }\n    }\n}\nexport #\n\n\nlet syntaxCase = macro {\n    function(stx, context) {\n        var name_stx = stx[0];\n        var here = quoteSyntax{here};\n\n        if (!(stx[1] && stx[1].token && stx[1].token.inner) ||\n            !(stx[2] && stx[2].token && stx[2].token.inner)) {\n            throwSyntaxError("macro", "Macro `syntaxCase` could not be matched" , stx[1]);\n        }\n\n        var arg_stx = stx[1].expose().token.inner;\n        var cases_stx = stx[2].expose().token.inner;\n\n        var Token = parser.Token;\n        var assert = parser.assert;\n        var loadPattern = patternModule.loadPattern;\n        var takeLine = patternModule.takeLine;\n        var matchPatterns = matchPatterns;\n\n        function makeFunc(params, body) {\n            return [\n                makeKeyword("function", here),\n                makeDelim("()", params, here),\n                makeDelim("{}", body, here)\n            ];\n        }\n\n        function makeVarDef(id, expr) {\n            return [\n                makeKeyword("var", here),\n                makeIdent(id, name_stx),\n                makePunc("=", here)\n            ].concat(expr, makePunc(";", here));\n        }\n\n        function makeAssign(id, expr) {\n          return [\n            makeIdent(id, name_stx),\n            makePunc("=", here)\n          ].concat(expr, makePunc(";", here));\n        }\n\n        function cloneSyntax(stx) {\n            var clone = _.extend({}, stx, { token: _.clone(stx.token) });\n            if (clone.token.inner) {\n                clone.token.inner = clone.token.inner.map(cloneSyntax);\n            }\n            return clone;\n        }\n\n        if (cases_stx.length == 0) {\n            throw new Error("Must have at least one case")\n        }\n\n        var cases = [];\n\n        for (var i = 0; i < cases_stx.length; i += 4) {\n            var caseKwd = cases_stx[i];\n            var isInfix = cases_stx[i + 1].token.value === "infix";\n            if (isInfix) {\n                i += 1;\n            }\n            var casePattern = cases_stx[i + 1];\n            var caseArrow = cases_stx[i + 2];\n            var caseBody = cases_stx[i + 3];\n\n            if (!(caseKwd && caseKwd.token && caseKwd.token.value === "case")) {\n                throw new Error("expecting case keyword in syntax case");\n            }\n            if (!(casePattern && casePattern.token && casePattern.token.value === "{}")) {\n                throw new Error("expecting a pattern surrounded by {} in syntax case");\n            }\n            if (!(caseArrow && caseArrow.token && caseArrow.token.value === "=>")) {\n                throw new Error("expecting an arrow separating pattern from body in syntax case");\n            }\n            if (!(caseBody && caseBody.token && caseBody.token.value === "{}")) {\n                throw new Error("expecting a body surrounded by {} in syntax case");\n            }\n\n            // If infix, loop through the pattern separating the lhs and rhs.\n            if (isInfix) {\n                var pattern = cloneSyntax(casePattern).expose().token.inner;\n                var lhs = [];\n                var rhs = [];\n                var separator = null;\n                for (var j = 0; j < pattern.length; j++) {\n                    if (separator) {\n                        rhs.push(pattern[j]);\n                    } else {\n                        if (pattern[j].token.type === parser.Token.Punctuator &&\n                            pattern[j].token.value === \'|\') {\n                            separator = pattern[j];\n                        } else {\n                            lhs.push(pattern[j]);\n                        }\n                    }\n                }\n                if (!separator) {\n                    throwSyntaxError("syntaxCase", "Infix macros require a `|` separator", casePattern);\n                }\n                cases.push({\n                    lookbehind: loadPattern(lhs, true),\n                    pattern: loadPattern(rhs),\n                    body: caseBody.expose().token.inner\n                });\n            } else {\n                cases.push({\n                    lookbehind: [],\n                    pattern: loadPattern(cloneSyntax(casePattern).expose().token.inner),\n                    body: caseBody.expose().token.inner\n                });\n            }\n        }\n\n        function patternsToObject(pats) {\n            if (!pats.length) {\n                return makeDelim("[]", [], here);\n            }\n\n            var freshId = __fresh();\n            context.patternMap.set(freshId, pats);\n\n            return [\n                makeIdent("getPattern", here),\n                makeDelim("()", [\n                    makeValue(freshId, here)\n                ], here)\n            ];\n        }\n\n        function makeMatch(caseObj) {\n            var lhs = makeAssign("lhs", patternsToObject(caseObj.lookbehind));\n            var rhs = makeAssign("rhs", patternsToObject(caseObj.pattern));\n\n            var lhsMatch = makeAssign("lhsMatch", [\n                makeIdent("patternModule", here),\n                makePunc(".", here),\n                makeIdent("matchLookbehind", here),\n                makeDelim("()", [\n                    makeIdent("lhs", name_stx),\n                    makePunc(",", here),\n                    makeIdent("prevStx", name_stx),\n                    makePunc(",", here),\n                    makeIdent("prevTerms", name_stx),\n                    makePunc(",", here),\n                    makeIdent("context", name_stx)\n                ], here)\n            ]);\n\n            var rhsMatch = makeAssign("rhsMatch", [\n                makeIdent("patternModule", here),\n                makePunc(".", here),\n                makeIdent("matchPatterns", here),\n                makeDelim("()", [\n                    makeIdent("rhs", name_stx),\n                    makePunc(",", here),\n                    makeIdent("arg", name_stx),\n                    makePunc(",", here),\n                    makeIdent("context", name_stx),\n                    makePunc(",", here),\n                    makeValue(true, here)\n                ], here)\n            ]);\n\n            var mergeMatch = makeAssign("match", [\n                makeIdent("mergeMatches", here),\n                makeDelim("()", [\n                    makeIdent("rhsMatch", name_stx),\n                    makePunc(",", here),\n                ].concat(\n                    makeIdent("mergeMatches", here),\n                    makeDelim("()", [\n                        makeIdent("lhsMatch", name_stx),\n                        makePunc(",", here),\n                        makeIdent("parentMatch", name_stx)\n                    ], here)\n                ), here)\n            ]);\n\n            return lhs.concat(lhsMatch, [\n                makeKeyword("if", here),\n                makeDelim("()", [\n                    makeIdent("lhsMatch", name_stx),\n                    makePunc(".", here),\n                    makeIdent("success", here)\n                ], here),\n                makeDelim("{}", rhs.concat(rhsMatch, [\n                    makeKeyword("if", here),\n                    makeDelim("()", [\n                        makeIdent("rhsMatch", name_stx),\n                        makePunc(".", here),\n                        makeIdent("success", here)\n                    ], here),\n                    makeDelim("{}", mergeMatch.concat(makeTranscribe(caseObj)), here)\n                ]), here)\n            ]);\n        }\n\n        function makeTranscribe(caseObj) {\n            // applyMarkToPatternEnv (context.mark, match.patternEnv);\n            var applyPreMark = [\n                makeIdent("applyMarkToPatternEnv", here),\n                makeDelim("()", [\n                    makeIdent("context", name_stx),\n                    makePunc(".", here),\n                    makeIdent("mark", name_stx),\n                    makePunc(",", here),\n                    makeIdent("match", name_stx),\n                    makePunc(".", here),\n                    makeIdent("patternEnv", name_stx)\n                ], here),\n                makePunc(";", here)\n            ];\n            // var res = (function() { <caseObj.body> })();\n            var runBody = makeVarDef("res", [\n                makeDelim("()", makeFunc([], caseObj.body), here),\n                makeDelim("()", [], here)\n            ]);\n            // if (!Array.isArray(res)) { throwSyntaxError("macro", "Macro must return a syntax array", stx); }\n            var errHandling = [\n                makeKeyword("if", here),\n                makeDelim("()", [\n                    makePunc("!", here),\n                    makeIdent("Array", here),\n                    makePunc(".", here),\n                    makeIdent("isArray", here),\n                    makeDelim("()", [\n                        makeIdent("res", name_stx)\n                    ], here)\n                ], here),\n                makeDelim("{}", [\n                    makeIdent("throwSyntaxError", here),\n                    makeDelim("()", [\n                        makeValue("macro", here),\n                        makePunc(",", here),\n                        makeValue("Macro must return a syntax array", here),\n                        makePunc(",", here),\n                        makeIdent("stx", name_stx)\n                    ], here)\n                ], here)\n            ];\n            // res = res.map(function(stx) { return stx.mark(context.mark); })\n            var applyPostMark = [\n                makeIdent("res", name_stx),\n                makePunc("=", here),\n                makeIdent("res", name_stx),\n                makePunc(".", here),\n                makeIdent("map", here),\n                makeDelim("()", makeFunc([makeIdent("stx", here)], [\n                        makeKeyword("return", here),\n                        makeIdent("stx", here),\n                        makePunc(".", here),\n                        makeIdent("mark", here),\n                        makeDelim("()", [\n                            makeIdent("context", name_stx),\n                            makePunc(".", here),\n                            makeIdent("mark", here)\n                        ], here)\n                ]), here),\n                makePunc(";", here)\n            ];\n            // return { result: res, rest: match.rest };\n            var retResult = [\n                makeKeyword("return", here),\n                makeDelim("{}", [\n                    makeIdent("result", here), makePunc(":", here),\n                    makeIdent("res", name_stx),\n                    makePunc(",", here),\n                    makeIdent("rest", here), makePunc(":", here),\n                    makeIdent("match", name_stx), makePunc(".", here), makeIdent("rest", here),\n                    makePunc(",", here),\n                    makeIdent("prevStx", here), makePunc(":", here),\n                    makeIdent("lhsMatch", name_stx), makePunc(".", here), makeIdent("prevStx", here),\n                    makePunc(",", here),\n                    makeIdent("prevTerms", here), makePunc(":", here),\n                    makeIdent("lhsMatch", name_stx), makePunc(".", here), makeIdent("prevTerms", here)\n                ], here)\n            ];\n            return applyPreMark.concat(runBody, errHandling, applyPostMark, retResult);\n        }\n\n        var arg_def = makeVarDef("arg", [makeIdent("stx", name_stx)]);\n        var name_def = makeVarDef("name_stx", [\n            makeIdent("arg", name_stx),\n            makeDelim("[]", [makeValue(0, here)], here)\n        ]);\n        var match_defs = [\n            makeKeyword(\'var\', here),\n            makeIdent(\'lhs\', name_stx), makePunc(\',\', here),\n            makeIdent(\'lhsMatch\', name_stx), makePunc(\',\', here),\n            makeIdent(\'rhs\', name_stx), makePunc(\',\', here),\n            makeIdent(\'rhsMatch\', name_stx), makePunc(\',\', here),\n            makeIdent(\'match\', name_stx), makePunc(\',\', here),\n            makeIdent(\'res\', name_stx), makePunc(\';\', here),\n        ];\n\n        var body = arg_def.concat(name_def, match_defs);\n\n        for (var i = 0; i < cases.length; i++) {\n            body = body.concat(makeMatch(cases[i]));\n        }\n\n        body = body.concat(quoteSyntax {\n            throwSyntaxCaseError("Could not match any cases");\n        });\n\n        var res = makeFunc([\n            makeIdent("stx", name_stx),\n            makePunc(",", here),\n            makeIdent("context", name_stx),\n            makePunc(",", here),\n            makeIdent("prevStx", name_stx),\n            makePunc(",", here),\n            makeIdent("prevTerms", name_stx),\n            makePunc(",", here),\n            makeIdent("parentMatch", name_stx)\n        ], body).concat([\n            makeDelim("()", arg_stx.concat([\n                makePunc(",", here),\n                makeKeyword("typeof", here),\n                makeIdent("match", name_stx),\n                makePunc("!==", here),\n                makeValue("undefined", here),\n                makePunc("?", here),\n                makeIdent("match", name_stx),\n                makePunc(":", here),\n                makeDelim("{}", [], here)\n            ]), here)\n        ]);\n\n        return {\n            result: res,\n            rest: stx.slice(3)\n        }\n    }\n}\nexport syntaxCase\n\n\nlet macro = macro {\n    function(stx) {\n        var name_stx = stx[0];\n        var here = quoteSyntax{here};\n        var mac_name_stx;\n        var body_inner_stx;\n        var body_stx;\n        var takeLine = patternModule.takeLine;\n        var makeIdentityRule = patternModule.makeIdentityRule;\n        var rest;\n\n        if (stx[1] && stx[1].token.type === parser.Token.Delimiter &&\n            stx[1].token.value === "{}") {\n            mac_name_stx = null;\n            body_stx = stx[1];\n            body_inner_stx = stx[1].expose().token.inner;\n            rest = stx.slice(2);\n        } else {\n            mac_name_stx = [];\n            mac_name_stx.push(stx[1]);\n            body_stx = stx[2];\n            body_inner_stx = stx[2].expose().token.inner;\n            rest = stx.slice(3);\n        }\n\n        function makeFunc(params, body) {\n            return [\n                makeKeyword("function", here),\n                makeDelim("()", params, here),\n                makeDelim("{}", body, here)\n            ];\n        }\n\n        function translateRule(pattern, def, isInfix) {\n            var translatedPatt;\n            // When infix, we need to loop through the body and make sure there\n            // is a separator to distinguish the lhs and rhs.\n            if (isInfix) {\n                translatedPatt = [];\n                for (var i = 0, len = pattern.length; i < len; i++) {\n                    translatedPatt.push(pattern[i]);\n                    if (pattern[i].token.type === parser.Token.Punctuator &&\n                        pattern[i].token.value === \'|\') {\n                        translatedPatt.push(makeIdent("_", here));\n                        translatedPatt = translatedPatt.concat([makeIdent("$", here),\n                                                                makeDelim("()", pattern.slice(i + 1), here)]);\n                        break;\n                    }\n                }\n            } else {\n                translatedPatt = [makeIdent("_", here),\n                                  // wrapping the patterns in a group to disambiguate\n                                  // `_ (foo) ...`\n                                  // since the `(foo)` would be interpreted as a separator\n                                  makeIdent("$", here),\n                                  makeDelim("()", pattern, here)];\n            }\n\n            var translatedDef = [\n                makeKeyword("return", here),\n                takeLine(here[0], makeIdent("syntax", name_stx)),\n                makeDelim("{}", def, here)\n            ];\n\n            return [makeIdent("case", here)].concat(\n                isInfix ? makeIdent("infix", here) : [],\n                makeDelim("{}", translatedPatt, here),\n                makePunc("=>", here),\n                makeDelim("{}", translatedDef, here)\n            );\n        }\n\n        if (body_inner_stx[0] && body_inner_stx[0].token.value === "function") {\n\n            if (mac_name_stx) {\n                var res = [makeIdent("macro", here)].concat(mac_name_stx).concat(body_stx)\n                return {\n                    result: res,\n                    rest: rest\n                };\n            } else {\n                var res = [\n                    makeIdent("macro", here),\n                    body_stx\n                ];\n                return {\n                    result: res,\n                    rest: rest\n                };\n            }\n\n        }\n\n        var rules = [];\n        if (body_inner_stx[0] && body_inner_stx[0].token.value === "rule") {\n            for (var i = 0; i < body_inner_stx.length; i += 4) {\n                var isInfix = body_inner_stx[i + 1].token.value === \'infix\';\n                if (isInfix) {\n                    i += 1;\n                }\n\n                var rule_pattern = body_inner_stx[i + 1];\n                var rule_arrow = body_inner_stx[i + 2];\n                var rule_def = body_inner_stx[i + 3];\n\n                if (rule_pattern && rule_arrow && rule_arrow.token.value === "=>" && rule_def) {\n                    rules = rules.concat(translateRule(rule_pattern.expose().token.inner,\n                                                       rule_def.expose().token.inner,\n                                                       isInfix));\n                } else if (rule_pattern) {\n                    var idRule = makeIdentityRule(rule_pattern.token.inner, isInfix, rule_pattern);\n                    rules = rules.concat(translateRule(idRule.pattern, idRule.body, isInfix));\n                    i -= 2;\n                } else {\n                  throwSyntaxError("macro", "Macro `macro` could not be matched" , rule_arrow);\n                }\n            }\n            rules = makeDelim("{}", rules, here);\n\n        } else {\n            rules = body_stx;\n        }\n\n        var stxSyntaxCase = takeLine(here[0], makeIdent("syntaxCase", name_stx));\n        var res = mac_name_stx\n            ? [makeIdent("macro", here)].concat(mac_name_stx)\n            : [makeIdent("macro", here)];\n        res = res.concat(makeDelim("{}", makeFunc([makeIdent("stx", name_stx),\n                                                   makePunc(",", here),\n                                                   makeIdent("context", name_stx),\n                                                   makePunc(",", here),\n                                                   makeIdent("prevStx", name_stx),\n                                                   makePunc(",", here),\n                                                   makeIdent("prevTerms", name_stx)],\n                                                   [makeKeyword("return", here),\n                                                    stxSyntaxCase,\n                                                    makeDelim("()", [makeIdent("stx", name_stx),\n                                                                     makePunc(",", here),\n                                                                     makeIdent("context", name_stx),\n                                                                     makePunc(",", here),\n                                                                     makeIdent("prevStx", name_stx),\n                                                                     makePunc(",", here),\n                                                                     makeIdent("prevTerms", name_stx)], here),\n                                                    rules]),\n                                    here));\n\n\n        return {\n            result: res,\n            rest: rest\n        }\n    }\n}\nexport macro;\n\nmacro withSyntax_done {\n    case { _ $ctx ($vars ...) {$rest ...} } => {\n        var ctx = #{ $ctx };\n        var here = #{ here };\n        var vars = #{ $vars ... };\n        var rest = #{ $rest ... };\n\n        var res = [];\n\n        for (var i = 0; i < vars.length; i += 3) {\n            var name = vars[i];\n            var repeat = !!vars[i + 1].token.inner.length;\n            var rhs = vars[i + 2];\n\n            if (repeat) {\n                res.push(\n                    makeIdent(\'match\', ctx),\n                    makePunc(\'.\', here),\n                    makeIdent(\'patternEnv\', here),\n                    makeDelim(\'[]\', [makeValue(name.token.value, here)], here),\n                    makePunc(\'=\', here),\n                    makeDelim(\'{}\', [\n                        makeIdent(\'level\', here), makePunc(\':\', here), makeValue(1, here), makePunc(\',\', here),\n                        makeIdent(\'match\', here), makePunc(\':\', here), makeDelim(\'()\', #{\n                            (function(exp) {\n                                return exp.length\n                                    ? exp.map(function(t) { return { level: 0, match: [t] } })\n                                    : [{ level: 0, match: [] }];\n                            })\n                        }, here), makeDelim(\'()\', [rhs], here)\n                    ], here),\n                    makePunc(\';\', here)\n                );\n            } else {\n                res.push(\n                    makeIdent(\'match\', ctx),\n                    makePunc(\'.\', here),\n                    makeIdent(\'patternEnv\', here),\n                    makeDelim(\'[]\', [makeValue(name.token.value, here)], here),\n                    makePunc(\'=\', here),\n                    makeDelim(\'{}\', [\n                        makeIdent(\'level\', here), makePunc(\':\', here), makeValue(0, here), makePunc(\',\', here),\n                        makeIdent(\'match\', here), makePunc(\':\', here), rhs\n                    ], here),\n                    makePunc(\';\', here)\n                );\n            }\n        }\n\n        res = res.concat(rest);\n        res = [\n            makeDelim("()", [\n                makeKeyword("function", here),\n                makeDelim("()", [makeIdent("match", ctx)], here),\n                makeDelim("{}", res, here)\n            ], here),\n            makeDelim("()", [\n                makeIdent("patternModule", here),\n                makePunc(".", here),\n                makeIdent("cloneMatch", here),\n                makeDelim("()", [makeIdent("match", ctx)], here)\n            ], here)\n        ];\n\n        return res;\n    }\n}\n\nmacro withSyntax_bind {\n    rule { $name:ident $[...] = $rhs:expr } => {\n        $name (true) $rhs\n    }\n    rule { $name:ident = $rhs:expr } => {\n        $name () $rhs\n    }\n}\n\nlet withSyntax = macro {\n    case { $name ($binders:withSyntax_bind (,) ...) { $body ... } } => {\n        return #{\n            withSyntax_done $name ($binders ...) { $body ... }\n        }\n    }\n    case { $name ($binders:withSyntax_bind (,) ...) $quote:[#] { $body ... } } => {\n        return #{\n            withSyntax_done $name ($binders ...) {\n                return $quote { $body ... }\n            }\n        }\n    }\n}\nexport withSyntax;\n\nmacro letstx_bind {\n    rule { $name:ident = $rhs:expr , $more:letstx_bind } => {\n        $name () $rhs $more\n    }\n    rule { $name:ident = $rhs:expr ;... letstx $more:letstx_bind } => {\n        $name () $rhs $more\n    }\n    rule { $name:ident = $rhs:expr ;... } => {\n        $name () $rhs\n    }\n    rule { $name:ident $[...] = $rhs:expr , $more:letstx_bind } => {\n        $name (true) $rhs $more\n    }\n    rule { $name:ident $[...] = $rhs:expr ;... letstx $more:letstx_bind } => {\n        $name (true) $rhs $more\n    }\n    rule { $name:ident $[...] = $rhs:expr ;... } => {\n        $name (true) $rhs\n    }\n}\n\nlet letstx = macro {\n    case { $name $binders:letstx_bind $rest ... } => {\n        return #{\n            return withSyntax_done $name ($binders) { $rest ... }\n        }\n    }\n}\nexport letstx;\n\n\nmacro macroclass {\n    rule { $name:ident { $decls:macroclass_decl ... } } => {\n        macro $name {\n            function (stx, context, prevStx, prevTerms) {\n                var name_stx = stx[0];\n                var match;\n                macroclass_create $name stx context match ($decls ...)\n            }\n        }\n    }\n}\n\nmacro macroclass_decl {\n    rule { $kw:[name] = $name:lit ;... } => {\n        ($kw $name)\n    }\n    rule { $kw:[pattern] { $mods:macroclass_modifier ... } ;... } => {\n        ($kw $mods ...)\n    }\n    rule { rule { $rule ... } ;... } => {\n        (pattern (rule ($rule ...)))\n    }\n}\n\nmacro macroclass_modifier {\n    rule { $kw:[name] = $name:lit ;... } => {\n        ($kw $name)\n    }\n    rule { $kw:[rule] { $rule ... } ;... } => {\n        ($kw ($rule ...))\n    }\n    rule { $kw:[with] $($lhs:macroclass_with_lhs = $rhs:macroclass_with_rhs) (,) ... } => {\n        $(($kw ($lhs) ($rhs))) ...\n    }\n    rule { ; ;... } => { }\n}\n\nmacro macroclass_with_lhs {\n    rule { $name:ident $[...] }\n    rule { $name:ident }\n}\n\nmacro macroclass_with_rhs {\n    rule { #{ $stx ... } }\n    rule { $code:expr }\n}\n\nmacro macroclass_create {\n    function(stx, context, prevStx, prevTerms) {\n        var here = quoteSyntax { here };\n        var macName = stx[0];\n        var nameStx = stx[1];\n        var stxName = stx[2];\n        var ctxName = stx[3];\n        var matchName = stx[4];\n        var decls = stx[5].expose().token.inner;\n        var mclass = decls.reduce(function(m, decl) {\n            var tag = unwrapSyntax(decl.token.inner[0]);\n            if (tag === \'name\') {\n                if (m.name) {\n                    throwSyntaxError(\'macroclass\',\n                                     \'Duplicate name declaration\',\n                                     decl.token.inner[0])\n                }\n                m.name = unwrapSyntax(decl.token.inner[1]);\n            } else if (tag === \'pattern\') {\n                var patternStx = decl.expose().token.inner.slice(1);\n                var pattern = patternStx.reduce(function(p, mod) {\n                    var tag = unwrapSyntax(mod.token.inner[0]);\n                    if (tag === \'name\') {\n                        if (p.name) {\n                            throwSyntaxError(\'macroclass\',\n                                             \'Duplicate name declaration\',\n                                             mod.token.inner[0])\n                        }\n                        p.name = unwrapSyntax(mod.token.inner[1]);\n                    } else if (tag === \'rule\') {\n                        if (p.rule) {\n                            throwSyntaxError(\'macroclass\',\n                                             \'Duplicate rule declaration\',\n                                             mod.token.inner[0])\n                        }\n                        p.rule = mod.expose().token.inner[1].expose().token.inner;\n                    } else if (tag === \'with\') {\n                        mod.expose();\n                        p.withs.push({\n                            lhs: mod.token.inner[1].expose().token.inner,\n                            rhs: mod.token.inner[2].expose().token.inner.map(function mapper(s) {\n                                // We need to transplant syntax quotes so that it looks\n                                // like they are within the macro body code and not\n                                // the original code, otherwise it won\'t expand.\n                                if (unwrapSyntax(s) === \'#\') {\n                                    s.context = macName.context;\n                                } else if (s.token.type === parser.Token.Delimiter) {\n                                    s.expose();\n                                    s.token.inner = s.token.inner.map(mapper);\n                                }\n                                return s;\n                            })\n                        });\n                    }\n                    return p;\n                }, { withs: [] });\n                m.patterns.push(pattern);\n            }\n            return m;\n        }, { patterns: [] });\n\n        var body = mclass.patterns.reduce(function(stx, pattern) {\n            var ruleStx = [makeIdent(\'_\', here)].concat(pattern.rule);\n            var ruleId = __fresh();\n            var rule = patternModule.loadPattern(ruleStx);\n\n            context.patternMap.set(ruleId, rule);\n\n            var withBindings = pattern.withs.reduce(function(acc, w) {\n                return acc.concat(w.lhs.concat(makePunc(\'=\', here), w.rhs, makePunc(\',\', here)));\n            }, []);\n\n            var ret = [\n                makeKeyword(\'return\', here), makeDelim(\'{}\', [\n                    makeIdent(\'result\', here), makePunc(\':\', here), makeDelim(\'[]\', [], here),\n                    makePunc(\',\', here),\n                    makeIdent(\'rest\', here), makePunc(\':\', here),\n                    matchName, makePunc(\'.\', here), makeIdent(\'rest\', here),\n                    makePunc(\',\', here),\n                    makeIdent(\'patterns\', here), makePunc(\':\', here),\n                    matchName, makePunc(\'.\', here), makeIdent(\'patternEnv\', here),\n                ], here)\n            ];\n\n            var inner = ret;\n            if (withBindings.length) {\n                inner = [\n                    makeKeyword(\'return\', macName), makeIdent(\'withSyntax\', macName),\n                    makeDelim(\'()\', withBindings, here),\n                    makeDelim(\'{}\', ret, here)\n                ];\n            }\n\n            var res = [\n                matchName, makePunc(\'=\', here),\n                makeIdent(\'patternModule\', here), makePunc(\'.\', here),\n                makeIdent(\'matchPatterns\', here), makeDelim(\'()\', [\n                    makeIdent(\'getPattern\', here), makeDelim(\'()\', [\n                        makeValue(ruleId, here)\n                    ], here),\n                    makePunc(\',\', here), stxName,\n                    makePunc(\',\', here), ctxName,\n                    makePunc(\',\', here), makeValue(true, here)\n                ], here),\n                makePunc(\';\', here),\n                makeKeyword(\'if\', here), makeDelim(\'()\', [\n                    matchName, makePunc(\'.\', here), makeIdent(\'success\', here)\n                ], here), makeDelim(\'{}\', inner, here)\n            ];\n          \n            return stx.concat(res);\n\n        }, []);\n\n        var res = body.concat(\n            makeIdent(\'throwSyntaxCaseError\', here),\n            makeDelim(\'()\', [\n                makeValue(mclass.name || unwrapSyntax(nameStx), here), makePunc(\',\', here),\n                makeValue(\'No match\', here)\n            ], here)\n        );\n\n        return {\n            result: res,\n            rest: stx.slice(6)\n        };\n    }\n}\n\nexport macroclass;\n\nmacro safemacro {\n    rule { $name:ident { rule $body ... } } => {\n        let $name = macro {\n            rule { : } => { $name : }\n            rule infix { . | } => { . $name }\n            rule $body ...\n        }\n    }\n    rule { $name:ident { case $body ... } } => {\n        let $name = macro {\n            case { _ : } => { return #{ $name : } }\n            case infix { . | _ } => { return #{ . $name } }\n            case $body ...\n        }\n    }\n}\n\nmacro op_assoc {\n    rule { left }\n    rule { right }\n}\n\nmacro op_name {\n    rule { ($name ...) }\n    rule { $name } => { ($name) }\n}\n\nsafemacro operator {\n    rule {\n        $name:op_name $prec:lit $assoc:op_assoc\n        { $left:ident, $right:ident } => #{ $body ... }\n    } => {\n        binaryop $name $prec $assoc {\n            macro {\n                rule { ($left:expr) ($right:expr) } => { $body ... }\n            }\n        }\n    }\n    rule {\n        $name:op_name $prec:lit { $op:ident } => #{ $body ... }\n    } => {\n        unaryop $name $prec {\n            macro {\n                rule { $op:expr } => { $body ... }\n            }\n        }\n    }\n}\nexport operator;\n\n// macro __log {\n//     case { _ defctx $stx } => {\n//         var context = #{ $stx }[0].context;\n//         console.log("defctx context for " + unwrapSyntax(#{$stx}) + "]");\n//         while (context) {\n//             if (context.defctx) {\n//                 console.log(context.defctx.map(function(d) {\n//                     return d.id.token.value\n//                 }));\n//             }\n//             context = context.context;\n//         }\n//         return [];\n//     }\n//     case {_ rename $stx } => {\n//         var context = #{ $stx }[0].context;\n//         console.log("rename context for " + unwrapSyntax(#{$stx}) + ":");\n//         while (context) {\n//             if (context.name) {\n//                 console.log("[name: " + context.name + ", id: " + context.id.token.value + "]");\n//             }\n//             context = context.context;\n//         }\n//         return [];\n//     }\n//     case {_ all $stx } => {\n//         var context = #{ $stx }[0].context;\n//         console.log("context for " + unwrapSyntax(#{$stx}) + ":");\n//         while (context) {\n//             if (context.name) {\n//                 console.log("rename@[name: " + context.name + ", id: " + context.id.token.value + "]");\n//             }\n//             if (context.mark) {\n//                 console.log("mark@[mark: " + context.mark + "]");\n//             }\n//             if (context.defctx) {\n//                 console.log("defctx@[" + context.defctx.map(function(d) {\n//                     return d.id.token.value\n//                 }) + "]");\n//             }\n//             context = context.context;\n//         }\n//         return [];\n//     }\n// }\n// export __log;\n';
var moduleCache = {};
var cwd = process.cwd();
var requireModule = function (id, filename) {
    var basedir = filename ? path.dirname(filename) : cwd;
    var key = basedir + id;
    if (!moduleCache[key]) {
        moduleCache[key] = _dereq_(resolveSync(id, { basedir: basedir }));
    }
    return moduleCache[key];
};
// Alow require('./example') for an example.sjs file.
if (_dereq_.extensions) {
    _dereq_.extensions['.sjs'] = function (module, filename) {
        var content = _dereq_('fs').readFileSync(filename, 'utf8');
        module._compile(codegen.generate(exports.parse(content, exports.loadedMacros)), filename);
    };
}
var _ = _dereq_('underscore');
var parser = _dereq_('./parser');
var expander = _dereq_('./expander');
var syn = _dereq_('./syntax');
var escope = _dereq_('escope');
var codegen = _dereq_('escodegen');
var expand = makeExpand(expander.expand);
var expandModule = makeExpand(expander.expandModule);
var stxcaseCtx;
function makeExpand(expandFn) {
    // fun (Str) -> [...CSyntax]
    return function expand$2(code, modules, options) {
        var program, toString;
        modules = modules || [];
        if (!stxcaseCtx) {
            stxcaseCtx = expander.expandModule(parser.read(stxcaseModule));
        }
        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }
        var source$2 = code;
        if (source$2.length > 0) {
            if (typeof source$2[0] === 'undefined') {
                // Try first to convert to a string. This is good as fast path
                // for old IE which understands string indexing for string
                // literals only and not for string object.
                if (code instanceof String) {
                    source$2 = code.valueOf();
                }
                // Force accessing the characters via an array.
                if (typeof source$2[0] === 'undefined') {
                    source$2 = stringToArray(code);
                }
            }
        }
        var readTree = parser.read(source$2);
        try {
            return expandFn(readTree, [stxcaseCtx].concat(modules), options);
        } catch (err) {
            if (err instanceof syn.MacroSyntaxError) {
                throw new SyntaxError(syn.printSyntaxError(source$2, err));
            } else {
                throw err;
            }
        }
    };
}
function expandSyntax(stx, modules, options) {
    if (!stxcaseCtx) {
        stxcaseCtx = expander.expandModule(parser.read(stxcaseModule));
    }
    var isSyntax = syn.isSyntax(stx);
    options = options || {};
    options.flatten = false;
    if (!isSyntax) {
        stx = syn.tokensToSyntax(stx);
    }
    try {
        var result = expander.expand(stx, [stxcaseCtx].concat(modules), options);
        return isSyntax ? result : syn.syntaxToTokens(result);
    } catch (err) {
        if (err instanceof syn.MacroSyntaxError) {
            throw new SyntaxError(syn.printSyntaxError(source, err));
        } else {
            throw err;
        }
    }
}
// fun (Str, {}) -> AST
function parse(code, modules, options) {
    if (code === '') {
        // old version of esprima doesn't play nice with the empty string
        // and loc/range info so until we can upgrade hack in a single space
        code = ' ';
    }
    modules = modules ? loadedMacros.concat(modules) : modules;
    return parser.parse(expand(code, modules, options));
}
// (Str, {sourceMap: ?Bool, filename: ?Str})
//    -> { code: Str, sourceMap: ?Str }
function compile(code, options) {
    var output;
    options = options || {};
    options.requireModule = options.requireModule || requireModule;
    var ast = parse(code, options.modules || [], options);
    if (options.readableNames) {
        ast = optimizeHygiene(ast);
    }
    if (options.ast) {
        return ast;
    }
    if (options.sourceMap) {
        output = codegen.generate(ast, _.extend({
            comment: true,
            sourceMap: options.filename,
            sourceMapWithCode: true
        }, options.escodegen));
        return {
            code: output.code,
            sourceMap: output.map.toString()
        };
    }
    return { code: codegen.generate(ast, _.extend({ comment: true }, options.escodegen)) };
}
var baseReadtable = Object.create({
        extend: function (obj) {
            var extended = Object.create(this);
            Object.keys(obj).forEach(function (ch) {
                extended[ch] = obj[ch];
            });
            return extended;
        }
    });
parser.setReadtable(baseReadtable, syn);
function setReadtable(readtableModule) {
    var filename = resolveSync(readtableModule, { basedir: process.cwd() });
    var readtable = _dereq_(filename);
    parser.setReadtable(_dereq_(filename));
}
function currentReadtable() {
    return parser.currentReadtable();
}
function loadNodeModule(root, moduleName, options) {
    options = options || {};
    if (moduleName[0] === '.') {
        moduleName = path.resolve(root, moduleName);
    }
    var filename = resolveSync(moduleName, {
            basedir: root,
            extensions: [
                '.js',
                '.sjs'
            ]
        });
    return expandModule(fs.readFileSync(filename, 'utf8'), undefined, {
        filename: moduleName,
        requireModule: options.requireModule || requireModule
    });
}
function optimizeHygiene(ast) {
    // escope hack: sweet doesn't rename global vars. We wrap in a closure
    // to create a 'static` scope for all of the vars sweet renamed.
    var wrapper = parse('(function(){})()');
    wrapper.body[0].expression.callee.body.body = ast.body;
    function sansUnique(name) {
        var match = name.match(/^(.+)\$[\d]+$/);
        return match ? match[1] : null;
    }
    function wouldShadow(name, scope) {
        while (scope) {
            if (scope.scrubbed && scope.scrubbed.has(name)) {
                return scope.scrubbed.get(name);
            }
            scope = scope.upper;
        }
        return 0;
    }
    var scopes = escope.analyze(wrapper).scopes;
    var globalScope;
    // The first pass over the scope collects any non-static references,
    // which means references from the global scope. We need to make these
    // verboten so we don't accidently mangle a name to match. This could
    // cause seriously hard to find bugs if you were just testing with
    // --readable-names on.
    scopes.forEach(function (scope) {
        scope.scrubbed = new expander.StringMap();
        // There aren't any references declared in the global scope since
        // we wrapped our input in a static closure.
        if (!scope.isStatic()) {
            globalScope = scope;
            return;
        }
        scope.references.forEach(function (ref) {
            if (!ref.isStatic()) {
                globalScope.scrubbed.set(ref.identifier.name, 1);
            }
        });
    });
    // The second pass mangles the names to get rid of the hygiene tag
    // wherever possible.
    scopes.forEach(function (scope) {
        // No need to rename things in the global scope.
        if (!scope.isStatic()) {
            return;
        }
        scope.variables.forEach(function (variable) {
            var name = sansUnique(variable.name);
            if (!name) {
                return;
            }
            var level = wouldShadow(name, scope);
            if (level) {
                scope.scrubbed.set(name, level + 1);
                name = name + '$' + (level + 1);
            } else {
                scope.scrubbed.set(name, 1);
            }
            variable.identifiers.forEach(function (i) {
                i.name = name;
            });
            variable.references.forEach(function (r) {
                r.identifier.name = name;
            });
        });
    });
    return ast;
}
var loadedMacros = [];
// syntax sugar for
// sweet.loadedMacros.push(sweet.loadNodeModule(process.cwd(), './macros/str'));
function loadMacro(relative_file) {
    loadedMacros.push(loadNodeModule(process.cwd(), relative_file));
}
exports.expand = expand;
exports.expandSyntax = expandSyntax;
exports.parse = parse;
exports.compile = compile;
exports.setReadtable = setReadtable;
exports.currentReadtable = currentReadtable;
exports.loadModule = expandModule;
exports.loadNodeModule = loadNodeModule;
exports.loadedMacros = loadedMacros;
exports.loadMacro = loadMacro;
//# sourceMappingURL=sweet.js.map
}).call(this,_dereq_("JkpR2F"))
},{"./expander":1,"./parser":2,"./syntax":6,"JkpR2F":17,"escodegen":7,"escope":13,"fs":15,"path":16,"resolve/lib/sync":22,"underscore":33}],6:[function(_dereq_,module,exports){
var _ = _dereq_('underscore');
var parser = _dereq_('./parser');
var expander = _dereq_('./expander');
function assert(condition, message) {
    if (!condition) {
        throw new Error('ASSERT: ' + message);
    }
}
// Keep an incrementing global counter so that a particular
// each new context object is assigned a unique "instance number"
// that it can be identified by. This helps with the memoization
// of the recursive resolveCtx implementation in expander.js.
// The memoization addresses issue #232.
var globalContextInstanceNumber = 1;
// (CSyntax, Str) -> CContext
function Rename(id, name, ctx, defctx) {
    defctx = defctx || null;
    this.id = id;
    this.name = name;
    this.context = ctx;
    this.def = defctx;
    this.instNum = globalContextInstanceNumber++;
}
// (Num) -> CContext
function Mark(mark, ctx) {
    this.mark = mark;
    this.context = ctx;
    this.instNum = globalContextInstanceNumber++;
}
function Def(defctx, ctx) {
    this.defctx = defctx;
    this.context = ctx;
    this.instNum = globalContextInstanceNumber++;
}
function Syntax(token, oldstx) {
    this.token = token;
    this.context = oldstx && oldstx.context ? oldstx.context : null;
    this.deferredContext = oldstx && oldstx.deferredContext ? oldstx.deferredContext : null;
}
Syntax.prototype = {
    mark: function (newMark) {
        if (this.token.inner) {
            return syntaxFromToken(this.token, {
                deferredContext: new Mark(newMark, this.deferredContext),
                context: new Mark(newMark, this.context)
            });
        }
        return syntaxFromToken(this.token, { context: new Mark(newMark, this.context) });
    },
    rename: function (id, name, defctx) {
        // defer renaming of delimiters
        if (this.token.inner) {
            return syntaxFromToken(this.token, {
                deferredContext: new Rename(id, name, this.deferredContext, defctx),
                context: new Rename(id, name, this.context, defctx)
            });
        }
        return syntaxFromToken(this.token, { context: new Rename(id, name, this.context, defctx) });
    },
    addDefCtx: function (defctx) {
        if (this.token.inner) {
            return syntaxFromToken(this.token, {
                deferredContext: new Def(defctx, this.deferredContext),
                context: new Def(defctx, this.context)
            });
        }
        return syntaxFromToken(this.token, { context: new Def(defctx, this.context) });
    },
    getDefCtx: function () {
        var ctx = this.context;
        while (ctx !== null) {
            if (ctx instanceof Def) {
                return ctx.defctx;
            }
            ctx = ctx.context;
        }
        return null;
    },
    expose: function () {
        assert(this.token.type === parser.Token.Delimiter, 'Only delimiters can be exposed');
        function applyContext(stxCtx, ctx) {
            if (ctx == null) {
                return stxCtx;
            } else if (ctx instanceof Rename) {
                return new Rename(ctx.id, ctx.name, applyContext(stxCtx, ctx.context), ctx.def);
            } else if (ctx instanceof Mark) {
                return new Mark(ctx.mark, applyContext(stxCtx, ctx.context));
            } else if (ctx instanceof Def) {
                return new Def(ctx.defctx, applyContext(stxCtx, ctx.context));
            } else {
                assert(false, 'unknown context type');
            }
        }
        var self = this;
        this.token.inner = _.map(this.token.inner, function (stx) {
            // when not a syntax object (aka a TermTree) then no need to push down the expose
            if (!stx.token) {
                return stx;
            }
            if (stx.token.inner) {
                return syntaxFromToken(stx.token, {
                    deferredContext: applyContext(stx.deferredContext, self.deferredContext),
                    context: applyContext(stx.context, self.deferredContext)
                });
            } else {
                return syntaxFromToken(stx.token, { context: applyContext(stx.context, self.deferredContext) });
            }
        });
        this.deferredContext = null;
        return this;
    },
    toString: function () {
        var val = this.token.type === parser.Token.EOF ? 'EOF' : this.token.value;
        return '[Syntax: ' + val + ']';
    }
};
// (CToken, CSyntax?) -> CSyntax
function syntaxFromToken(token, oldstx) {
    return new Syntax(token, oldstx);
}
function mkSyntax(stx, value, type, inner) {
    if (stx && Array.isArray(stx) && stx.length === 1) {
        stx = stx[0];
    } else if (stx && Array.isArray(stx)) {
        throwSyntaxError('mkSyntax', 'Expecting a syntax object or an array with a single syntax object');
    } else if (stx === undefined) {
        throwSyntaxError('mkSyntax', 'You must provide an old syntax object context (or null) when creating a new syntax object.');
    }
    if (type === parser.Token.Delimiter) {
        var startLineNumber, startLineStart, endLineNumber, endLineStart, startRange, endRange;
        if (!Array.isArray(inner)) {
            throwSyntaxError('mkSyntax', 'Must provide inner array of syntax objects when creating a delimiter');
        }
        if (stx && stx.token.type === parser.Token.Delimiter) {
            startLineNumber = stx.token.startLineNumber;
            startLineStart = stx.token.startLineStart;
            endLineNumber = stx.token.endLineNumber;
            endLineStart = stx.token.endLineStart;
            startRange = stx.token.startRange;
            endRange = stx.token.endRange;
        } else if (stx && stx.token) {
            startLineNumber = stx.token.lineNumber;
            startLineStart = stx.token.lineStart;
            endLineNumber = stx.token.lineNumber;
            endLineStart = stx.token.lineStart;
            startRange = stx.token.range;
            endRange = stx.token.range;
        }
        return syntaxFromToken({
            type: parser.Token.Delimiter,
            value: value,
            inner: inner,
            startLineStart: startLineStart,
            startLineNumber: startLineNumber,
            endLineStart: endLineStart,
            endLineNumber: endLineNumber,
            startRange: startRange,
            endRange: endRange
        }, stx);
    } else {
        var lineStart, lineNumber, range;
        if (stx && stx.token.type === parser.Token.Delimiter) {
            lineStart = stx.token.startLineStart;
            lineNumber = stx.token.startLineNumber;
            range = stx.token.startRange;
        } else if (stx && stx.token) {
            lineStart = stx.token.lineStart;
            lineNumber = stx.token.lineNumber;
            range = stx.token.range;
        }
        return syntaxFromToken({
            type: type,
            value: value,
            lineStart: lineStart,
            lineNumber: lineNumber,
            range: range
        }, stx);
    }
}
function makeValue(val, stx) {
    if (typeof val === 'boolean') {
        return mkSyntax(stx, val ? 'true' : 'false', parser.Token.BooleanLiteral);
    } else if (typeof val === 'number') {
        if (val !== val) {
            return makeDelim('()', [
                makeValue(0, stx),
                makePunc('/', stx),
                makeValue(0, stx)
            ], stx);
        }
        if (val < 0) {
            return makeDelim('()', [
                makePunc('-', stx),
                makeValue(Math.abs(val), stx)
            ], stx);
        } else {
            return mkSyntax(stx, val, parser.Token.NumericLiteral);
        }
    } else if (typeof val === 'string') {
        return mkSyntax(stx, val, parser.Token.StringLiteral);
    } else if (val === null) {
        return mkSyntax(stx, 'null', parser.Token.NullLiteral);
    } else {
        throwSyntaxError('makeValue', 'Cannot make value syntax object from: ' + val);
    }
}
function makeRegex(val, flags, stx) {
    var newstx = mkSyntax(stx, new RegExp(val, flags), parser.Token.RegexLiteral);
    // regex tokens need the extra field literal on token
    newstx.token.literal = val;
    return newstx;
}
function makeIdent(val, stx) {
    return mkSyntax(stx, val, parser.Token.Identifier);
}
function makeKeyword(val, stx) {
    return mkSyntax(stx, val, parser.Token.Keyword);
}
function makePunc(val, stx) {
    return mkSyntax(stx, val, parser.Token.Punctuator);
}
function makeDelim(val, inner, stx) {
    return mkSyntax(stx, val, parser.Token.Delimiter, inner);
}
function unwrapSyntax(stx) {
    if (Array.isArray(stx) && stx.length === 1) {
        // pull stx out of single element arrays for convenience
        stx = stx[0];
    }
    if (stx.token) {
        if (stx.token.type === parser.Token.Delimiter) {
            return stx.token;
        } else {
            return stx.token.value;
        }
    } else {
        throw new Error('Not a syntax object: ' + stx);
    }
}
// ([...CSyntax]) -> [...CToken]
function syntaxToTokens(stx) {
    return _.map(stx, function (stx$2) {
        if (stx$2.token.inner) {
            stx$2.token.inner = syntaxToTokens(stx$2.token.inner);
        }
        return stx$2.token;
    });
}
// (CToken or [...CToken]) -> [...CSyntax]
function tokensToSyntax(tokens) {
    if (!_.isArray(tokens)) {
        tokens = [tokens];
    }
    return _.map(tokens, function (token) {
        if (token.inner) {
            token.inner = tokensToSyntax(token.inner);
        }
        return syntaxFromToken(token);
    });
}
// ([...CSyntax], Str) -> [...CSyntax])
function joinSyntax(tojoin, punc) {
    if (tojoin.length === 0) {
        return [];
    }
    if (punc === ' ') {
        return tojoin;
    }
    return _.reduce(_.rest(tojoin, 1), function (acc, join) {
        acc.push(makePunc(punc, join), join);
        return acc;
    }, [_.first(tojoin)]);
}
// ([...[...CSyntax]], Str) -> [...CSyntax]
function joinSyntaxArray(tojoin, punc) {
    if (tojoin.length === 0) {
        return [];
    }
    if (punc === ' ') {
        return _.flatten(tojoin, true);
    }
    return _.reduce(_.rest(tojoin, 1), function (acc, join) {
        acc.push(makePunc(punc, _.first(join)));
        Array.prototype.push.apply(acc, join);
        return acc;
    }, _.first(tojoin));
}
function cloneSyntaxArray(arr) {
    return arr.map(function (stx) {
        var o = syntaxFromToken(_.clone(stx.token), stx);
        if (o.token.type === parser.Token.Delimiter) {
            o.token.inner = cloneSyntaxArray(o.token.inner);
        }
        return o;
    });
}
function MacroSyntaxError(name, message, stx) {
    this.name = name;
    this.message = message;
    this.stx = stx;
}
function throwSyntaxError(name, message, stx) {
    if (stx && Array.isArray(stx)) {
        stx = stx[0];
    }
    throw new MacroSyntaxError(name, message, stx);
}
function SyntaxCaseError(message) {
    this.message = message;
}
function throwSyntaxCaseError(message) {
    throw new SyntaxCaseError(message);
}
function printSyntaxError(code, err) {
    if (!err.stx) {
        return '[' + err.name + '] ' + err.message;
    }
    var token = err.stx.token;
    var lineNumber = token.sm_startLineNumber || token.sm_lineNumber || token.startLineNumber || token.lineNumber;
    var lineStart = token.sm_startLineStart || token.sm_lineStart || token.startLineStart || token.lineStart;
    var start = (token.sm_startRange || token.sm_range || token.startRange || token.range)[0];
    var offset = start - lineStart;
    var line = '';
    var pre = lineNumber + ': ';
    var ch;
    while (ch = code.charAt(lineStart++)) {
        if (ch == '\r' || ch == '\n') {
            break;
        }
        line += ch;
    }
    return '[' + err.name + '] ' + err.message + '\n' + pre + line + '\n' + Array(offset + pre.length).join(' ') + ' ^';
}
// fun ([...CSyntax]) -> String
function prettyPrint(stxarr, shouldResolve) {
    var indent = 0;
    var unparsedLines = stxarr.reduce(function (acc, stx) {
            var s = shouldResolve ? expander.resolve(stx) : stx.token.value;
            // skip the end of file token
            if (stx.token.type === parser.Token.EOF) {
                return acc;
            }
            if (stx.token.type === parser.Token.StringLiteral) {
                s = '"' + s + '"';
            }
            if (s == '{') {
                acc[0].str += ' ' + s;
                indent++;
                acc.unshift({
                    indent: indent,
                    str: ''
                });
            } else if (s == '}') {
                indent--;
                acc.unshift({
                    indent: indent,
                    str: s
                });
                acc.unshift({
                    indent: indent,
                    str: ''
                });
            } else if (s == ';') {
                acc[0].str += s;
                acc.unshift({
                    indent: indent,
                    str: ''
                });
            } else {
                acc[0].str += (acc[0].str ? ' ' : '') + s;
            }
            return acc;
        }, [{
                indent: 0,
                str: ''
            }]);
    return unparsedLines.reduce(function (acc, line) {
        var ind = '';
        while (ind.length < line.indent * 2) {
            ind += ' ';
        }
        return ind + line.str + '\n' + acc;
    }, '');
}
exports.assert = assert;
exports.unwrapSyntax = unwrapSyntax;
exports.makeDelim = makeDelim;
exports.makePunc = makePunc;
exports.makeKeyword = makeKeyword;
exports.makeIdent = makeIdent;
exports.makeRegex = makeRegex;
exports.makeValue = makeValue;
exports.Rename = Rename;
exports.Mark = Mark;
exports.Def = Def;
exports.syntaxFromToken = syntaxFromToken;
exports.tokensToSyntax = tokensToSyntax;
exports.syntaxToTokens = syntaxToTokens;
exports.isSyntax = function (obj) {
    obj = Array.isArray(obj) ? obj[0] : obj;
    return obj instanceof Syntax;
};
exports.joinSyntax = joinSyntax;
exports.joinSyntaxArray = joinSyntaxArray;
exports.cloneSyntaxArray = cloneSyntaxArray;
exports.prettyPrint = prettyPrint;
exports.MacroSyntaxError = MacroSyntaxError;
exports.throwSyntaxError = throwSyntaxError;
exports.SyntaxCaseError = SyntaxCaseError;
exports.throwSyntaxCaseError = throwSyntaxCaseError;
exports.printSyntaxError = printSyntaxError;
//# sourceMappingURL=syntax.js.map
},{"./expander":1,"./parser":2,"underscore":33}],7:[function(_dereq_,module,exports){
(function (global){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
  Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
  Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
  Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
  Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*global exports:true, generateStatement:true, generateExpression:true, require:true, global:true*/
(function () {
    'use strict';

    var Syntax,
        Precedence,
        BinaryPrecedence,
        SourceNode,
        estraverse,
        esutils,
        isArray,
        base,
        indent,
        json,
        renumber,
        hexadecimal,
        quotes,
        escapeless,
        newline,
        space,
        parentheses,
        semicolons,
        safeConcatenation,
        directive,
        extra,
        parse,
        sourceMap,
        FORMAT_MINIFY,
        FORMAT_DEFAULTS;

    estraverse = _dereq_('estraverse');
    esutils = _dereq_('esutils');

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ComprehensionBlock: 'ComprehensionBlock',
        ComprehensionExpression: 'ComprehensionExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExportDeclaration: 'ExportDeclaration',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        ForOfStatement: 'ForOfStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        GeneratorExpression: 'GeneratorExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    Precedence = {
        Sequence: 0,
        Yield: 1,
        Assignment: 1,
        Conditional: 2,
        ArrowFunction: 2,
        LogicalOR: 3,
        LogicalAND: 4,
        BitwiseOR: 5,
        BitwiseXOR: 6,
        BitwiseAND: 7,
        Equality: 8,
        Relational: 9,
        BitwiseSHIFT: 10,
        Additive: 11,
        Multiplicative: 12,
        Unary: 13,
        Postfix: 14,
        Call: 15,
        New: 16,
        Member: 17,
        Primary: 18
    };

    BinaryPrecedence = {
        '||': Precedence.LogicalOR,
        '&&': Precedence.LogicalAND,
        '|': Precedence.BitwiseOR,
        '^': Precedence.BitwiseXOR,
        '&': Precedence.BitwiseAND,
        '==': Precedence.Equality,
        '!=': Precedence.Equality,
        '===': Precedence.Equality,
        '!==': Precedence.Equality,
        'is': Precedence.Equality,
        'isnt': Precedence.Equality,
        '<': Precedence.Relational,
        '>': Precedence.Relational,
        '<=': Precedence.Relational,
        '>=': Precedence.Relational,
        'in': Precedence.Relational,
        'instanceof': Precedence.Relational,
        '<<': Precedence.BitwiseSHIFT,
        '>>': Precedence.BitwiseSHIFT,
        '>>>': Precedence.BitwiseSHIFT,
        '+': Precedence.Additive,
        '-': Precedence.Additive,
        '*': Precedence.Multiplicative,
        '%': Precedence.Multiplicative,
        '/': Precedence.Multiplicative
    };

    function getDefaultOptions() {
        // default options
        return {
            indent: null,
            base: null,
            parse: null,
            comment: false,
            format: {
                indent: {
                    style: '    ',
                    base: 0,
                    adjustMultilineComment: false
                },
                newline: '\n',
                space: ' ',
                json: false,
                renumber: false,
                hexadecimal: false,
                quotes: 'single',
                escapeless: false,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: false
            },
            moz: {
                comprehensionExpressionStartsWithAssignment: false,
                starlessGenerator: false,
                parenthesizedComprehensionBlock: false
            },
            sourceMap: null,
            sourceMapRoot: null,
            sourceMapWithCode: false,
            directive: false,
            verbatim: null
        };
    }

    function stringRepeat(str, num) {
        var result = '';

        for (num |= 0; num > 0; num >>>= 1, str += str) {
            if (num & 1) {
                result += str;
            }
        }

        return result;
    }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function hasLineTerminator(str) {
        return (/[\r\n]/g).test(str);
    }

    function endsWithLineTerminator(str) {
        var len = str.length;
        return len && esutils.code.isLineTerminator(str.charCodeAt(len - 1));
    }

    function updateDeeply(target, override) {
        var key, val;

        function isHashObject(target) {
            return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
        }

        for (key in override) {
            if (override.hasOwnProperty(key)) {
                val = override[key];
                if (isHashObject(val)) {
                    if (isHashObject(target[key])) {
                        updateDeeply(target[key], val);
                    } else {
                        target[key] = updateDeeply({}, val);
                    }
                } else {
                    target[key] = val;
                }
            }
        }
        return target;
    }

    function generateNumber(value) {
        var result, point, temp, exponent, pos;

        if (value !== value) {
            throw new Error('Numeric literal whose value is NaN');
        }
        if (value < 0 || (value === 0 && 1 / value < 0)) {
            throw new Error('Numeric literal whose value is negative');
        }

        if (value === 1 / 0) {
            return json ? 'null' : renumber ? '1e400' : '1e+400';
        }

        result = '' + value;
        if (!renumber || result.length < 3) {
            return result;
        }

        point = result.indexOf('.');
        if (!json && result.charCodeAt(0) === 0x30  /* 0 */ && point === 1) {
            point = 0;
            result = result.slice(1);
        }
        temp = result;
        result = result.replace('e+', 'e');
        exponent = 0;
        if ((pos = temp.indexOf('e')) > 0) {
            exponent = +temp.slice(pos + 1);
            temp = temp.slice(0, pos);
        }
        if (point >= 0) {
            exponent -= temp.length - point - 1;
            temp = +(temp.slice(0, point) + temp.slice(point + 1)) + '';
        }
        pos = 0;
        while (temp.charCodeAt(temp.length + pos - 1) === 0x30  /* 0 */) {
            --pos;
        }
        if (pos !== 0) {
            exponent -= pos;
            temp = temp.slice(0, pos);
        }
        if (exponent !== 0) {
            temp += 'e' + exponent;
        }
        if ((temp.length < result.length ||
                    (hexadecimal && value > 1e12 && Math.floor(value) === value && (temp = '0x' + value.toString(16)).length < result.length)) &&
                +temp === value) {
            result = temp;
        }

        return result;
    }

    // Generate valid RegExp expression.
    // This function is based on https://github.com/Constellation/iv Engine

    function escapeRegExpCharacter(ch, previousIsBackslash) {
        // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
        if ((ch & ~1) === 0x2028) {
            return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
        } else if (ch === 10 || ch === 13) {  // \n, \r
            return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
        }
        return String.fromCharCode(ch);
    }

    function generateRegExp(reg) {
        var match, result, flags, i, iz, ch, characterInBrack, previousIsBackslash;

        result = reg.toString();

        if (reg.source) {
            // extract flag from toString result
            match = result.match(/\/([^/]*)$/);
            if (!match) {
                return result;
            }

            flags = match[1];
            result = '';

            characterInBrack = false;
            previousIsBackslash = false;
            for (i = 0, iz = reg.source.length; i < iz; ++i) {
                ch = reg.source.charCodeAt(i);

                if (!previousIsBackslash) {
                    if (characterInBrack) {
                        if (ch === 93) {  // ]
                            characterInBrack = false;
                        }
                    } else {
                        if (ch === 47) {  // /
                            result += '\\';
                        } else if (ch === 91) {  // [
                            characterInBrack = true;
                        }
                    }
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    previousIsBackslash = ch === 92;  // \
                } else {
                    // if new RegExp("\\\n') is provided, create /\n/
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    // prevent like /\\[/]/
                    previousIsBackslash = false;
                }
            }

            return '/' + result + '/' + flags;
        }

        return result;
    }

    function escapeAllowedCharacter(code, next) {
        var hex, result = '\\';

        switch (code) {
        case 0x08  /* \b */:
            result += 'b';
            break;
        case 0x0C  /* \f */:
            result += 'f';
            break;
        case 0x09  /* \t */:
            result += 't';
            break;
        default:
            hex = code.toString(16).toUpperCase();
            if (json || code > 0xFF) {
                result += 'u' + '0000'.slice(hex.length) + hex;
            } else if (code === 0x0000 && !esutils.code.isDecimalDigit(next)) {
                result += '0';
            } else if (code === 0x000B  /* \v */) { // '\v'
                result += 'x0B';
            } else {
                result += 'x' + '00'.slice(hex.length) + hex;
            }
            break;
        }

        return result;
    }

    function escapeDisallowedCharacter(code) {
        var result = '\\';
        switch (code) {
        case 0x5C  /* \ */:
            result += '\\';
            break;
        case 0x0A  /* \n */:
            result += 'n';
            break;
        case 0x0D  /* \r */:
            result += 'r';
            break;
        case 0x2028:
            result += 'u2028';
            break;
        case 0x2029:
            result += 'u2029';
            break;
        default:
            throw new Error('Incorrectly classified character');
        }

        return result;
    }

    function escapeDirective(str) {
        var i, iz, code, quote;

        quote = quotes === 'double' ? '"' : '\'';
        for (i = 0, iz = str.length; i < iz; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                quote = '"';
                break;
            } else if (code === 0x22  /* " */) {
                quote = '\'';
                break;
            } else if (code === 0x5C  /* \ */) {
                ++i;
            }
        }

        return quote + str + quote;
    }

    function escapeString(str) {
        var result = '', i, len, code, singleQuotes = 0, doubleQuotes = 0, single, quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                ++singleQuotes;
            } else if (code === 0x22  /* " */) {
                ++doubleQuotes;
            } else if (code === 0x2F  /* / */ && json) {
                result += '\\';
            } else if (esutils.code.isLineTerminator(code) || code === 0x5C  /* \ */) {
                result += escapeDisallowedCharacter(code);
                continue;
            } else if ((json && code < 0x20  /* SP */) || !(json || escapeless || (code >= 0x20  /* SP */ && code <= 0x7E  /* ~ */))) {
                result += escapeAllowedCharacter(code, str.charCodeAt(i + 1));
                continue;
            }
            result += String.fromCharCode(code);
        }

        single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
        quote = single ? '\'' : '"';

        if (!(single ? singleQuotes : doubleQuotes)) {
            return quote + result + quote;
        }

        str = result;
        result = quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if ((code === 0x27  /* ' */ && single) || (code === 0x22  /* " */ && !single)) {
                result += '\\';
            }
            result += String.fromCharCode(code);
        }

        return result + quote;
    }

    /**
     * flatten an array to a string, where the array can contain
     * either strings or nested arrays
     */
    function flattenToString(arr) {
        var i, iz, elem, result = '';
        for (i = 0, iz = arr.length; i < iz; ++i) {
            elem = arr[i];
            result += isArray(elem) ? flattenToString(elem) : elem;
        }
        return result;
    }

    /**
     * convert generated to a SourceNode when source maps are enabled.
     */
    function toSourceNodeWhenNeeded(generated, node) {
        if (!sourceMap) {
            // with no source maps, generated is either an
            // array or a string.  if an array, flatten it.
            // if a string, just return it
            if (isArray(generated)) {
                return flattenToString(generated);
            } else {
                return generated;
            }
        }
        if (node == null) {
            if (generated instanceof SourceNode) {
                return generated;
            } else {
                node = {};
            }
        }
        if (node.loc == null) {
            return new SourceNode(null, null, sourceMap, generated, node.name || null);
        }
        return new SourceNode(node.loc.start.line, node.loc.start.column, (sourceMap === true ? node.loc.source || null : sourceMap), generated, node.name || null);
    }

    function noEmptySpace() {
        return (space) ? space : ' ';
    }

    function join(left, right) {
        var leftSource = toSourceNodeWhenNeeded(left).toString(),
            rightSource = toSourceNodeWhenNeeded(right).toString(),
            leftCharCode = leftSource.charCodeAt(leftSource.length - 1),
            rightCharCode = rightSource.charCodeAt(0);

        if ((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode ||
        esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode) ||
        leftCharCode === 0x2F  /* / */ && rightCharCode === 0x69  /* i */) { // infix word operators all start with `i`
            return [left, noEmptySpace(), right];
        } else if (esutils.code.isWhiteSpace(leftCharCode) || esutils.code.isLineTerminator(leftCharCode) ||
                esutils.code.isWhiteSpace(rightCharCode) || esutils.code.isLineTerminator(rightCharCode)) {
            return [left, right];
        }
        return [left, space, right];
    }

    function addIndent(stmt) {
        return [base, stmt];
    }

    function withIndent(fn) {
        var previousBase, result;
        previousBase = base;
        base += indent;
        result = fn.call(this, base);
        base = previousBase;
        return result;
    }

    function calculateSpaces(str) {
        var i;
        for (i = str.length - 1; i >= 0; --i) {
            if (esutils.code.isLineTerminator(str.charCodeAt(i))) {
                break;
            }
        }
        return (str.length - 1) - i;
    }

    function adjustMultilineComment(value, specialBase) {
        var array, i, len, line, j, spaces, previousBase, sn;

        array = value.split(/\r\n|[\r\n]/);
        spaces = Number.MAX_VALUE;

        // first line doesn't have indentation
        for (i = 1, len = array.length; i < len; ++i) {
            line = array[i];
            j = 0;
            while (j < line.length && esutils.code.isWhiteSpace(line.charCodeAt(j))) {
                ++j;
            }
            if (spaces > j) {
                spaces = j;
            }
        }

        if (typeof specialBase !== 'undefined') {
            // pattern like
            // {
            //   var t = 20;  /*
            //                 * this is comment
            //                 */
            // }
            previousBase = base;
            if (array[1][spaces] === '*') {
                specialBase += ' ';
            }
            base = specialBase;
        } else {
            if (spaces & 1) {
                // /*
                //  *
                //  */
                // If spaces are odd number, above pattern is considered.
                // We waste 1 space.
                --spaces;
            }
            previousBase = base;
        }

        for (i = 1, len = array.length; i < len; ++i) {
            sn = toSourceNodeWhenNeeded(addIndent(array[i].slice(spaces)));
            array[i] = sourceMap ? sn.join('') : sn;
        }

        base = previousBase;

        return array.join('\n');
    }

    function generateComment(comment, specialBase) {
        if (comment.type === 'Line') {
            if (endsWithLineTerminator(comment.value)) {
                return '//' + comment.value;
            } else {
                // Always use LineTerminator
                return '//' + comment.value + '\n';
            }
        }
        if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
            return adjustMultilineComment('/*' + comment.value + '*/', specialBase);
        }
        return '/*' + comment.value + '*/';
    }

    function addCommentsToStatement(stmt, result) {
        var i, len, comment, save, tailingToStatement, specialBase, fragment;

        if (stmt.leadingComments && stmt.leadingComments.length > 0) {
            save = result;

            comment = stmt.leadingComments[0];
            result = [];
            if (safeConcatenation && stmt.type === Syntax.Program && stmt.body.length === 0) {
                result.push('\n');
            }
            result.push(generateComment(comment));
            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push('\n');
            }

            for (i = 1, len = stmt.leadingComments.length; i < len; ++i) {
                comment = stmt.leadingComments[i];
                fragment = [generateComment(comment)];
                if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    fragment.push('\n');
                }
                result.push(addIndent(fragment));
            }

            result.push(addIndent(save));
        }

        if (stmt.trailingComments) {
            tailingToStatement = !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
            specialBase = stringRepeat(' ', calculateSpaces(toSourceNodeWhenNeeded([base, result, indent]).toString()));
            for (i = 0, len = stmt.trailingComments.length; i < len; ++i) {
                comment = stmt.trailingComments[i];
                if (tailingToStatement) {
                    // We assume target like following script
                    //
                    // var t = 20;  /**
                    //               * This is comment of t
                    //               */
                    if (i === 0) {
                        // first case
                        result = [result, indent];
                    } else {
                        result = [result, specialBase];
                    }
                    result.push(generateComment(comment, specialBase));
                } else {
                    result = [result, addIndent(generateComment(comment))];
                }
                if (i !== len - 1 && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result = [result, '\n'];
                }
            }
        }

        return result;
    }

    function parenthesize(text, current, should) {
        if (current < should) {
            return ['(', text, ')'];
        }
        return text;
    }

    function maybeBlock(stmt, semicolonOptional, functionBody) {
        var result, noLeadingComment;

        noLeadingComment = !extra.comment || !stmt.leadingComments;

        if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
            return [space, generateStatement(stmt, { functionBody: functionBody })];
        }

        if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
            return ';';
        }

        withIndent(function () {
            result = [newline, addIndent(generateStatement(stmt, { semicolonOptional: semicolonOptional, functionBody: functionBody }))];
        });

        return result;
    }

    function maybeBlockSuffix(stmt, result) {
        var ends = endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
        if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
            return [result, space];
        }
        if (ends) {
            return [result, base];
        }
        return [result, newline, base];
    }

    function generateVerbatim(expr, option) {
        var i, result;
        result = expr[extra.verbatim].split(/\r\n|\n/);
        for (i = 1; i < result.length; i++) {
            result[i] = newline + base + result[i];
        }

        result = parenthesize(result, Precedence.Sequence, option.precedence);
        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateIdentifier(node) {
        return toSourceNodeWhenNeeded(node.name, node);
    }

    function generatePattern(node, options) {
        var result;

        if (node.type === Syntax.Identifier) {
            result = generateIdentifier(node);
        } else {
            result = generateExpression(node, {
                precedence: options.precedence,
                allowIn: options.allowIn,
                allowCall: true
            });
        }

        return result;
    }

    function generateFunctionBody(node) {
        var result, i, len, expr, arrow;

        arrow = node.type === Syntax.ArrowFunctionExpression;

        if (arrow && node.params.length === 1 && node.params[0].type === Syntax.Identifier) {
            // arg => { } case
            result = [generateIdentifier(node.params[0])];
        } else {
            result = ['('];
            for (i = 0, len = node.params.length; i < len; ++i) {
                result.push(generatePattern(node.params[i], {
                    precedence: Precedence.Assignment,
                    allowIn: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');
        }

        if (arrow) {
            result.push(space);
            result.push('=>');
        }

        if (node.expression) {
            result.push(space);
            expr = generateExpression(node.body, {
                precedence: Precedence.Assignment,
                allowIn: true,
                allowCall: true
            });
            if (expr.toString().charAt(0) === '{') {
                expr = ['(', expr, ')'];
            }
            result.push(expr);
        } else {
            result.push(maybeBlock(node.body, false, true));
        }
        return result;
    }

    function generateIterationForStatement(operator, stmt, semicolonIsNotNeeded) {
        var result = ['for' + space + '('];
        withIndent(function () {
            if (stmt.left.type === Syntax.VariableDeclaration) {
                withIndent(function () {
                    result.push(stmt.left.kind + noEmptySpace());
                    result.push(generateStatement(stmt.left.declarations[0], {
                        allowIn: false
                    }));
                });
            } else {
                result.push(generateExpression(stmt.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                }));
            }

            result = join(result, operator);
            result = [join(
                result,
                generateExpression(stmt.right, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), ')'];
        });
        result.push(maybeBlock(stmt.body, semicolonIsNotNeeded));
        return result;
    }

    function generateExpression(expr, option) {
        var result,
            precedence,
            type,
            currentPrecedence,
            i,
            len,
            raw,
            fragment,
            multiline,
            leftCharCode,
            leftSource,
            rightCharCode,
            allowIn,
            allowCall,
            allowUnparenthesizedNew,
            property,
            isGenerator;

        precedence = option.precedence;
        allowIn = option.allowIn;
        allowCall = option.allowCall;
        type = expr.type || option.type;

        if (extra.verbatim && expr.hasOwnProperty(extra.verbatim)) {
            return generateVerbatim(expr, option);
        }

        switch (type) {
        case Syntax.SequenceExpression:
            result = [];
            allowIn |= (Precedence.Sequence < precedence);
            for (i = 0, len = expr.expressions.length; i < len; ++i) {
                result.push(generateExpression(expr.expressions[i], {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result = parenthesize(result, Precedence.Sequence, precedence);
            break;

        case Syntax.AssignmentExpression:
            allowIn |= (Precedence.Assignment < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.left, {
                        precedence: Precedence.Call,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + expr.operator + space,
                    generateExpression(expr.right, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Assignment,
                precedence
            );
            break;

        case Syntax.ArrowFunctionExpression:
            allowIn |= (Precedence.ArrowFunction < precedence);
            result = parenthesize(generateFunctionBody(expr), Precedence.ArrowFunction, precedence);
            break;

        case Syntax.ConditionalExpression:
            allowIn |= (Precedence.Conditional < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.test, {
                        precedence: Precedence.LogicalOR,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + '?' + space,
                    generateExpression(expr.consequent, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + ':' + space,
                    generateExpression(expr.alternate, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Conditional,
                precedence
            );
            break;

        case Syntax.LogicalExpression:
        case Syntax.BinaryExpression:
            currentPrecedence = BinaryPrecedence[expr.operator];

            allowIn |= (currentPrecedence < precedence);

            fragment = generateExpression(expr.left, {
                precedence: currentPrecedence,
                allowIn: allowIn,
                allowCall: true
            });

            leftSource = fragment.toString();

            if (leftSource.charCodeAt(leftSource.length - 1) === 0x2F /* / */ && esutils.code.isIdentifierPart(expr.operator.charCodeAt(0))) {
                result = [fragment, noEmptySpace(), expr.operator];
            } else {
                result = join(fragment, expr.operator);
            }

            fragment = generateExpression(expr.right, {
                precedence: currentPrecedence + 1,
                allowIn: allowIn,
                allowCall: true
            });

            if (expr.operator === '/' && fragment.toString().charAt(0) === '/' ||
            expr.operator.slice(-1) === '<' && fragment.toString().slice(0, 3) === '!--') {
                // If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
                result.push(noEmptySpace());
                result.push(fragment);
            } else {
                result = join(result, fragment);
            }

            if (expr.operator === 'in' && !allowIn) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, currentPrecedence, precedence);
            }

            break;

        case Syntax.CallExpression:
            result = [generateExpression(expr.callee, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: true,
                allowUnparenthesizedNew: false
            })];

            result.push('(');
            for (i = 0, len = expr['arguments'].length; i < len; ++i) {
                result.push(generateExpression(expr['arguments'][i], {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');

            if (!allowCall) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, Precedence.Call, precedence);
            }
            break;

        case Syntax.NewExpression:
            len = expr['arguments'].length;
            allowUnparenthesizedNew = option.allowUnparenthesizedNew === undefined || option.allowUnparenthesizedNew;

            result = join(
                'new',
                generateExpression(expr.callee, {
                    precedence: Precedence.New,
                    allowIn: true,
                    allowCall: false,
                    allowUnparenthesizedNew: allowUnparenthesizedNew && !parentheses && len === 0
                })
            );

            if (!allowUnparenthesizedNew || parentheses || len > 0) {
                result.push('(');
                for (i = 0; i < len; ++i) {
                    result.push(generateExpression(expr['arguments'][i], {
                        precedence: Precedence.Assignment,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + space);
                    }
                }
                result.push(')');
            }

            result = parenthesize(result, Precedence.New, precedence);
            break;

        case Syntax.MemberExpression:
            result = [generateExpression(expr.object, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: allowCall,
                allowUnparenthesizedNew: false
            })];

            if (expr.computed) {
                result.push('[');
                result.push(generateExpression(expr.property, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: allowCall
                }));
                result.push(']');
            } else {
                if (expr.object.type === Syntax.Literal && typeof expr.object.value === 'number') {
                    fragment = toSourceNodeWhenNeeded(result).toString();
                    // When the following conditions are all true,
                    //   1. No floating point
                    //   2. Don't have exponents
                    //   3. The last character is a decimal digit
                    //   4. Not hexadecimal OR octal number literal
                    // we should add a floating point.
                    if (
                            fragment.indexOf('.') < 0 &&
                            !/[eExX]/.test(fragment) &&
                            esutils.code.isDecimalDigit(fragment.charCodeAt(fragment.length - 1)) &&
                            !(fragment.length >= 2 && fragment.charCodeAt(0) === 48)  // '0'
                            ) {
                        result.push('.');
                    }
                }
                result.push('.');
                result.push(generateIdentifier(expr.property));
            }

            result = parenthesize(result, Precedence.Member, precedence);
            break;

        case Syntax.UnaryExpression:
            fragment = generateExpression(expr.argument, {
                precedence: Precedence.Unary,
                allowIn: true,
                allowCall: true
            });

            if (space === '') {
                result = join(expr.operator, fragment);
            } else {
                result = [expr.operator];
                if (expr.operator.length > 2) {
                    // delete, void, typeof
                    // get `typeof []`, not `typeof[]`
                    result = join(result, fragment);
                } else {
                    // Prevent inserting spaces between operator and argument if it is unnecessary
                    // like, `!cond`
                    leftSource = toSourceNodeWhenNeeded(result).toString();
                    leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
                    rightCharCode = fragment.toString().charCodeAt(0);

                    if (((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode) ||
                            (esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode))) {
                        result.push(noEmptySpace());
                        result.push(fragment);
                    } else {
                        result.push(fragment);
                    }
                }
            }
            result = parenthesize(result, Precedence.Unary, precedence);
            break;

        case Syntax.YieldExpression:
            if (expr.delegate) {
                result = 'yield*';
            } else {
                result = 'yield';
            }
            if (expr.argument) {
                result = join(
                    result,
                    generateExpression(expr.argument, {
                        precedence: Precedence.Yield,
                        allowIn: true,
                        allowCall: true
                    })
                );
            }
            result = parenthesize(result, Precedence.Yield, precedence);
            break;

        case Syntax.UpdateExpression:
            if (expr.prefix) {
                result = parenthesize(
                    [
                        expr.operator,
                        generateExpression(expr.argument, {
                            precedence: Precedence.Unary,
                            allowIn: true,
                            allowCall: true
                        })
                    ],
                    Precedence.Unary,
                    precedence
                );
            } else {
                result = parenthesize(
                    [
                        generateExpression(expr.argument, {
                            precedence: Precedence.Postfix,
                            allowIn: true,
                            allowCall: true
                        }),
                        expr.operator
                    ],
                    Precedence.Postfix,
                    precedence
                );
            }
            break;

        case Syntax.FunctionExpression:
            isGenerator = expr.generator && !extra.moz.starlessGenerator;
            result = isGenerator ? 'function*' : 'function';

            if (expr.id) {
                result = [result, (isGenerator) ? space : noEmptySpace(),
                          generateIdentifier(expr.id),
                          generateFunctionBody(expr)];
            } else {
                result = [result + space, generateFunctionBody(expr)];
            }

            break;

        case Syntax.ArrayPattern:
        case Syntax.ArrayExpression:
            if (!expr.elements.length) {
                result = '[]';
                break;
            }
            multiline = expr.elements.length > 1;
            result = ['[', multiline ? newline : ''];
            withIndent(function (indent) {
                for (i = 0, len = expr.elements.length; i < len; ++i) {
                    if (!expr.elements[i]) {
                        if (multiline) {
                            result.push(indent);
                        }
                        if (i + 1 === len) {
                            result.push(',');
                        }
                    } else {
                        result.push(multiline ? indent : '');
                        result.push(generateExpression(expr.elements[i], {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        }));
                    }
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });
            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push(']');
            break;

        case Syntax.Property:
            if (expr.kind === 'get' || expr.kind === 'set') {
                result = [
                    expr.kind, noEmptySpace(),
                    generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    generateFunctionBody(expr.value)
                ];
            } else {
                if (expr.shorthand) {
                    result = generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });
                } else if (expr.method) {
                    result = [];
                    if (expr.value.generator) {
                        result.push('*');
                    }
                    result.push(generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(generateFunctionBody(expr.value));
                } else {
                    result = [
                        generateExpression(expr.key, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        }),
                        ':' + space,
                        generateExpression(expr.value, {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        })
                    ];
                }
            }
            break;

        case Syntax.ObjectExpression:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }
            multiline = expr.properties.length > 1;

            withIndent(function () {
                fragment = generateExpression(expr.properties[0], {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true,
                    type: Syntax.Property
                });
            });

            if (!multiline) {
                // issues 4
                // Do not transform from
                //   dejavu.Class.declare({
                //       method2: function () {}
                //   });
                // to
                //   dejavu.Class.declare({method2: function () {
                //       }});
                if (!hasLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result = [ '{', space, fragment, space, '}' ];
                    break;
                }
            }

            withIndent(function (indent) {
                result = [ '{', newline, indent, fragment ];

                if (multiline) {
                    result.push(',' + newline);
                    for (i = 1, len = expr.properties.length; i < len; ++i) {
                        result.push(indent);
                        result.push(generateExpression(expr.properties[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true,
                            type: Syntax.Property
                        }));
                        if (i + 1 < len) {
                            result.push(',' + newline);
                        }
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(base);
            result.push('}');
            break;

        case Syntax.ObjectPattern:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }

            multiline = false;
            if (expr.properties.length === 1) {
                property = expr.properties[0];
                if (property.value.type !== Syntax.Identifier) {
                    multiline = true;
                }
            } else {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    property = expr.properties[i];
                    if (!property.shorthand) {
                        multiline = true;
                        break;
                    }
                }
            }
            result = ['{', multiline ? newline : '' ];

            withIndent(function (indent) {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    result.push(multiline ? indent : '');
                    result.push(generateExpression(expr.properties[i], {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });

            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push('}');
            break;

        case Syntax.ThisExpression:
            result = 'this';
            break;

        case Syntax.Identifier:
            result = generateIdentifier(expr);
            break;

        case Syntax.Literal:
            if (expr.hasOwnProperty('raw') && parse) {
                try {
                    raw = parse(expr.raw).body[0].expression;
                    if (raw.type === Syntax.Literal) {
                        if (raw.value === expr.value) {
                            result = expr.raw;
                            break;
                        }
                    }
                } catch (e) {
                    // not use raw property
                }
            }

            if (expr.value === null) {
                result = 'null';
                break;
            }

            if (typeof expr.value === 'string') {
                result = escapeString(expr.value);
                break;
            }

            if (typeof expr.value === 'number') {
                result = generateNumber(expr.value);
                break;
            }

            if (typeof expr.value === 'boolean') {
                result = expr.value ? 'true' : 'false';
                break;
            }

            result = generateRegExp(expr.value);
            break;

        case Syntax.GeneratorExpression:
        case Syntax.ComprehensionExpression:
            // GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
            // Due to https://bugzilla.mozilla.org/show_bug.cgi?id=883468 position of expr.body can differ in Spidermonkey and ES6
            result = (type === Syntax.GeneratorExpression) ? ['('] : ['['];

            if (extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result.push(fragment);
            }

            if (expr.blocks) {
                withIndent(function () {
                    for (i = 0, len = expr.blocks.length; i < len; ++i) {
                        fragment = generateExpression(expr.blocks[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        });

                        if (i > 0 || extra.moz.comprehensionExpressionStartsWithAssignment) {
                            result = join(result, fragment);
                        } else {
                            result.push(fragment);
                        }
                    }
                });
            }

            if (expr.filter) {
                result = join(result, 'if' + space);
                fragment = generateExpression(expr.filter, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                });
                if (extra.moz.parenthesizedComprehensionBlock) {
                    result = join(result, [ '(', fragment, ')' ]);
                } else {
                    result = join(result, fragment);
                }
            }

            if (!extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result = join(result, fragment);
            }

            result.push((type === Syntax.GeneratorExpression) ? ')' : ']');
            break;

        case Syntax.ComprehensionBlock:
            if (expr.left.type === Syntax.VariableDeclaration) {
                fragment = [
                    expr.left.kind, noEmptySpace(),
                    generateStatement(expr.left.declarations[0], {
                        allowIn: false
                    })
                ];
            } else {
                fragment = generateExpression(expr.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                });
            }

            fragment = join(fragment, expr.of ? 'of' : 'in');
            fragment = join(fragment, generateExpression(expr.right, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            }));

            if (extra.moz.parenthesizedComprehensionBlock) {
                result = [ 'for' + space + '(', fragment, ')' ];
            } else {
                result = join('for' + space, fragment);
            }
            break;

        default:
            throw new Error('Unknown expression type: ' + expr.type);
        }

        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateStatement(stmt, option) {
        var i,
            len,
            result,
            node,
            allowIn,
            functionBody,
            directiveContext,
            fragment,
            semicolon,
            isGenerator;

        allowIn = true;
        semicolon = ';';
        functionBody = false;
        directiveContext = false;
        if (option) {
            allowIn = option.allowIn === undefined || option.allowIn;
            if (!semicolons && option.semicolonOptional === true) {
                semicolon = '';
            }
            functionBody = option.functionBody;
            directiveContext = option.directiveContext;
        }

        switch (stmt.type) {
        case Syntax.BlockStatement:
            result = ['{', newline];

            withIndent(function () {
                for (i = 0, len = stmt.body.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.body[i], {
                        semicolonOptional: i === len - 1,
                        directiveContext: functionBody
                    }));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });

            result.push(addIndent('}'));
            break;

        case Syntax.BreakStatement:
            if (stmt.label) {
                result = 'break ' + stmt.label.name + semicolon;
            } else {
                result = 'break' + semicolon;
            }
            break;

        case Syntax.ContinueStatement:
            if (stmt.label) {
                result = 'continue ' + stmt.label.name + semicolon;
            } else {
                result = 'continue' + semicolon;
            }
            break;

        case Syntax.DirectiveStatement:
            if (stmt.raw) {
                result = stmt.raw + semicolon;
            } else {
                result = escapeDirective(stmt.directive) + semicolon;
            }
            break;

        case Syntax.DoWhileStatement:
            // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
            result = join('do', maybeBlock(stmt.body));
            result = maybeBlockSuffix(stmt.body, result);
            result = join(result, [
                'while' + space + '(',
                generateExpression(stmt.test, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                }),
                ')' + semicolon
            ]);
            break;

        case Syntax.CatchClause:
            withIndent(function () {
                var guard;

                result = [
                    'catch' + space + '(',
                    generateExpression(stmt.param, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];

                if (stmt.guard) {
                    guard = generateExpression(stmt.guard, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });

                    result.splice(2, 0, ' if ', guard);
                }
            });
            result.push(maybeBlock(stmt.body));
            break;

        case Syntax.DebuggerStatement:
            result = 'debugger' + semicolon;
            break;

        case Syntax.EmptyStatement:
            result = ';';
            break;

        case Syntax.ExportDeclaration:
            result = 'export ';
            if (stmt.declaration) {
                // FunctionDeclaration or VariableDeclaration
                result = [result, generateStatement(stmt.declaration, { semicolonOptional: semicolon === '' })];
                break;
            }
            break;

        case Syntax.ExpressionStatement:
            result = [generateExpression(stmt.expression, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            })];
            // 12.4 '{', 'function' is not allowed in this position.
            // wrap expression with parentheses
            fragment = toSourceNodeWhenNeeded(result).toString();
            if (fragment.charAt(0) === '{' ||  // ObjectExpression
                    (fragment.slice(0, 8) === 'function' && '* ('.indexOf(fragment.charAt(8)) >= 0) ||  // function or generator
                    (directive && directiveContext && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                result = ['(', result, ')' + semicolon];
            } else {
                result.push(semicolon);
            }
            break;

        case Syntax.VariableDeclarator:
            if (stmt.init) {
                result = [
                    generateExpression(stmt.id, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space,
                    '=',
                    space,
                    generateExpression(stmt.init, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ];
            } else {
                result = generatePattern(stmt.id, {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn
                });
            }
            break;

        case Syntax.VariableDeclaration:
            result = [stmt.kind];
            // special path for
            // var x = function () {
            // };
            if (stmt.declarations.length === 1 && stmt.declarations[0].init &&
                    stmt.declarations[0].init.type === Syntax.FunctionExpression) {
                result.push(noEmptySpace());
                result.push(generateStatement(stmt.declarations[0], {
                    allowIn: allowIn
                }));
            } else {
                // VariableDeclarator is typed as Statement,
                // but joined with comma (not LineTerminator).
                // So if comment is attached to target node, we should specialize.
                withIndent(function () {
                    node = stmt.declarations[0];
                    if (extra.comment && node.leadingComments) {
                        result.push('\n');
                        result.push(addIndent(generateStatement(node, {
                            allowIn: allowIn
                        })));
                    } else {
                        result.push(noEmptySpace());
                        result.push(generateStatement(node, {
                            allowIn: allowIn
                        }));
                    }

                    for (i = 1, len = stmt.declarations.length; i < len; ++i) {
                        node = stmt.declarations[i];
                        if (extra.comment && node.leadingComments) {
                            result.push(',' + newline);
                            result.push(addIndent(generateStatement(node, {
                                allowIn: allowIn
                            })));
                        } else {
                            result.push(',' + space);
                            result.push(generateStatement(node, {
                                allowIn: allowIn
                            }));
                        }
                    }
                });
            }
            result.push(semicolon);
            break;

        case Syntax.ThrowStatement:
            result = [join(
                'throw',
                generateExpression(stmt.argument, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), semicolon];
            break;

        case Syntax.TryStatement:
            result = ['try', maybeBlock(stmt.block)];
            result = maybeBlockSuffix(stmt.block, result);

            if (stmt.handlers) {
                // old interface
                for (i = 0, len = stmt.handlers.length; i < len; ++i) {
                    result = join(result, generateStatement(stmt.handlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.handlers[i].body, result);
                    }
                }
            } else {
                stmt.guardedHandlers = stmt.guardedHandlers || [];

                for (i = 0, len = stmt.guardedHandlers.length; i < len; ++i) {
                    result = join(result, generateStatement(stmt.guardedHandlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.guardedHandlers[i].body, result);
                    }
                }

                // new interface
                if (stmt.handler) {
                    if (isArray(stmt.handler)) {
                        for (i = 0, len = stmt.handler.length; i < len; ++i) {
                            result = join(result, generateStatement(stmt.handler[i]));
                            if (stmt.finalizer || i + 1 !== len) {
                                result = maybeBlockSuffix(stmt.handler[i].body, result);
                            }
                        }
                    } else {
                        result = join(result, generateStatement(stmt.handler));
                        if (stmt.finalizer) {
                            result = maybeBlockSuffix(stmt.handler.body, result);
                        }
                    }
                }
            }
            if (stmt.finalizer) {
                result = join(result, ['finally', maybeBlock(stmt.finalizer)]);
            }
            break;

        case Syntax.SwitchStatement:
            withIndent(function () {
                result = [
                    'switch' + space + '(',
                    generateExpression(stmt.discriminant, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')' + space + '{' + newline
                ];
            });
            if (stmt.cases) {
                for (i = 0, len = stmt.cases.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.cases[i], {semicolonOptional: i === len - 1}));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            }
            result.push(addIndent('}'));
            break;

        case Syntax.SwitchCase:
            withIndent(function () {
                if (stmt.test) {
                    result = [
                        join('case', generateExpression(stmt.test, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        })),
                        ':'
                    ];
                } else {
                    result = ['default:'];
                }

                i = 0;
                len = stmt.consequent.length;
                if (len && stmt.consequent[0].type === Syntax.BlockStatement) {
                    fragment = maybeBlock(stmt.consequent[0]);
                    result.push(fragment);
                    i = 1;
                }

                if (i !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result.push(newline);
                }

                for (; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.consequent[i], {semicolonOptional: i === len - 1 && semicolon === ''}));
                    result.push(fragment);
                    if (i + 1 !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });
            break;

        case Syntax.IfStatement:
            withIndent(function () {
                result = [
                    'if' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            if (stmt.alternate) {
                result.push(maybeBlock(stmt.consequent));
                result = maybeBlockSuffix(stmt.consequent, result);
                if (stmt.alternate.type === Syntax.IfStatement) {
                    result = join(result, ['else ', generateStatement(stmt.alternate, {semicolonOptional: semicolon === ''})]);
                } else {
                    result = join(result, join('else', maybeBlock(stmt.alternate, semicolon === '')));
                }
            } else {
                result.push(maybeBlock(stmt.consequent, semicolon === ''));
            }
            break;

        case Syntax.ForStatement:
            withIndent(function () {
                result = ['for' + space + '('];
                if (stmt.init) {
                    if (stmt.init.type === Syntax.VariableDeclaration) {
                        result.push(generateStatement(stmt.init, {allowIn: false}));
                    } else {
                        result.push(generateExpression(stmt.init, {
                            precedence: Precedence.Sequence,
                            allowIn: false,
                            allowCall: true
                        }));
                        result.push(';');
                    }
                } else {
                    result.push(';');
                }

                if (stmt.test) {
                    result.push(space);
                    result.push(generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(';');
                } else {
                    result.push(';');
                }

                if (stmt.update) {
                    result.push(space);
                    result.push(generateExpression(stmt.update, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(')');
                } else {
                    result.push(')');
                }
            });

            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.ForInStatement:
            result = generateIterationForStatement('in', stmt, semicolon === '');
            break;

        case Syntax.ForOfStatement:
            result = generateIterationForStatement('of', stmt, semicolon === '');
            break;

        case Syntax.LabeledStatement:
            result = [stmt.label.name + ':', maybeBlock(stmt.body, semicolon === '')];
            break;

        case Syntax.Program:
            len = stmt.body.length;
            result = [safeConcatenation && len > 0 ? '\n' : ''];
            for (i = 0; i < len; ++i) {
                fragment = addIndent(
                    generateStatement(stmt.body[i], {
                        semicolonOptional: !safeConcatenation && i === len - 1,
                        directiveContext: true
                    })
                );
                result.push(fragment);
                if (i + 1 < len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result.push(newline);
                }
            }
            break;

        case Syntax.FunctionDeclaration:
            isGenerator = stmt.generator && !extra.moz.starlessGenerator;
            result = [
                (isGenerator ? 'function*' : 'function'),
                (isGenerator ? space : noEmptySpace()),
                generateIdentifier(stmt.id),
                generateFunctionBody(stmt)
            ];
            break;

        case Syntax.ReturnStatement:
            if (stmt.argument) {
                result = [join(
                    'return',
                    generateExpression(stmt.argument, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    })
                ), semicolon];
            } else {
                result = ['return' + semicolon];
            }
            break;

        case Syntax.WhileStatement:
            withIndent(function () {
                result = [
                    'while' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.WithStatement:
            withIndent(function () {
                result = [
                    'with' + space + '(',
                    generateExpression(stmt.object, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        default:
            throw new Error('Unknown statement type: ' + stmt.type);
        }

        // Attach comments

        if (extra.comment) {
            result = addCommentsToStatement(stmt, result);
        }

        fragment = toSourceNodeWhenNeeded(result).toString();
        if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
            result = sourceMap ? toSourceNodeWhenNeeded(result).replaceRight(/\s+$/, '') : fragment.replace(/\s+$/, '');
        }

        return toSourceNodeWhenNeeded(result, stmt);
    }

    function generate(node, options) {
        var defaultOptions = getDefaultOptions(), result, pair;

        if (options != null) {
            // Obsolete options
            //
            //   `options.indent`
            //   `options.base`
            //
            // Instead of them, we can use `option.format.indent`.
            if (typeof options.indent === 'string') {
                defaultOptions.format.indent.style = options.indent;
            }
            if (typeof options.base === 'number') {
                defaultOptions.format.indent.base = options.base;
            }
            options = updateDeeply(defaultOptions, options);
            indent = options.format.indent.style;
            if (typeof options.base === 'string') {
                base = options.base;
            } else {
                base = stringRepeat(indent, options.format.indent.base);
            }
        } else {
            options = defaultOptions;
            indent = options.format.indent.style;
            base = stringRepeat(indent, options.format.indent.base);
        }
        json = options.format.json;
        renumber = options.format.renumber;
        hexadecimal = json ? false : options.format.hexadecimal;
        quotes = json ? 'double' : options.format.quotes;
        escapeless = options.format.escapeless;
        newline = options.format.newline;
        space = options.format.space;
        if (options.format.compact) {
            newline = space = indent = base = '';
        }
        parentheses = options.format.parentheses;
        semicolons = options.format.semicolons;
        safeConcatenation = options.format.safeConcatenation;
        directive = options.directive;
        parse = json ? null : options.parse;
        sourceMap = options.sourceMap;
        extra = options;

        if (sourceMap) {
            if (!exports.browser) {
                // We assume environment is node.js
                // And prevent from including source-map by browserify
                SourceNode = _dereq_('source-map').SourceNode;
            } else {
                SourceNode = global.sourceMap.SourceNode;
            }
        }

        switch (node.type) {
        case Syntax.BlockStatement:
        case Syntax.BreakStatement:
        case Syntax.CatchClause:
        case Syntax.ContinueStatement:
        case Syntax.DirectiveStatement:
        case Syntax.DoWhileStatement:
        case Syntax.DebuggerStatement:
        case Syntax.EmptyStatement:
        case Syntax.ExpressionStatement:
        case Syntax.ForStatement:
        case Syntax.ForInStatement:
        case Syntax.ForOfStatement:
        case Syntax.FunctionDeclaration:
        case Syntax.IfStatement:
        case Syntax.LabeledStatement:
        case Syntax.Program:
        case Syntax.ReturnStatement:
        case Syntax.SwitchStatement:
        case Syntax.SwitchCase:
        case Syntax.ThrowStatement:
        case Syntax.TryStatement:
        case Syntax.VariableDeclaration:
        case Syntax.VariableDeclarator:
        case Syntax.WhileStatement:
        case Syntax.WithStatement:
            result = generateStatement(node);
            break;

        case Syntax.AssignmentExpression:
        case Syntax.ArrayExpression:
        case Syntax.ArrayPattern:
        case Syntax.BinaryExpression:
        case Syntax.CallExpression:
        case Syntax.ConditionalExpression:
        case Syntax.FunctionExpression:
        case Syntax.Identifier:
        case Syntax.Literal:
        case Syntax.LogicalExpression:
        case Syntax.MemberExpression:
        case Syntax.NewExpression:
        case Syntax.ObjectExpression:
        case Syntax.ObjectPattern:
        case Syntax.Property:
        case Syntax.SequenceExpression:
        case Syntax.ThisExpression:
        case Syntax.UnaryExpression:
        case Syntax.UpdateExpression:
        case Syntax.YieldExpression:

            result = generateExpression(node, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            });
            break;

        default:
            throw new Error('Unknown node type: ' + node.type);
        }

        if (!sourceMap) {
            return result.toString();
        }


        pair = result.toStringWithSourceMap({
            file: options.file,
            sourceRoot: options.sourceMapRoot
        });

        if (options.sourceContent) {
            pair.map.setSourceContent(options.sourceMap,
                                      options.sourceContent);
        }

        if (options.sourceMapWithCode) {
            return pair;
        }

        return pair.map.toString();
    }

    FORMAT_MINIFY = {
        indent: {
            style: '',
            base: 0
        },
        renumber: true,
        hexadecimal: true,
        quotes: 'auto',
        escapeless: true,
        compact: true,
        parentheses: false,
        semicolons: false
    };

    FORMAT_DEFAULTS = getDefaultOptions().format;

    exports.version = _dereq_('./package.json').version;
    exports.generate = generate;
    exports.attachComments = estraverse.attachComments;
    exports.browser = false;
    exports.FORMAT_MINIFY = FORMAT_MINIFY;
    exports.FORMAT_DEFAULTS = FORMAT_DEFAULTS;
}());
/* vim: set sw=4 ts=4 et tw=80 : */

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./package.json":12,"estraverse":8,"esutils":11,"source-map":23}],8:[function(_dereq_,module,exports){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
/*jslint vars:false, bitwise:true*/
/*jshint indent:4*/
/*global exports:true, define:true*/
(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // and plain browser loading,
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.estraverse = {}));
    }
}(this, function (exports) {
    'use strict';

    var Syntax,
        isArray,
        VisitorOption,
        VisitorKeys,
        BREAK,
        SKIP;

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ClassBody: 'ClassBody',
        ClassDeclaration: 'ClassDeclaration',
        ClassExpression: 'ClassExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        MethodDefinition: 'MethodDefinition',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    function ignoreJSHintError() { }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function deepCopy(obj) {
        var ret = {}, key, val;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                val = obj[key];
                if (typeof val === 'object' && val !== null) {
                    ret[key] = deepCopy(val);
                } else {
                    ret[key] = val;
                }
            }
        }
        return ret;
    }

    function shallowCopy(obj) {
        var ret = {}, key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                ret[key] = obj[key];
            }
        }
        return ret;
    }
    ignoreJSHintError(shallowCopy);

    // based on LLVM libc++ upper_bound / lower_bound
    // MIT License

    function upperBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                len = diff;
            } else {
                i = current + 1;
                len -= diff + 1;
            }
        }
        return i;
    }

    function lowerBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                i = current + 1;
                len -= diff + 1;
            } else {
                len = diff;
            }
        }
        return i;
    }
    ignoreJSHintError(lowerBound);

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        ArrayExpression: ['elements'],
        ArrayPattern: ['elements'],
        ArrowFunctionExpression: ['params', 'defaults', 'rest', 'body'],
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ClassBody: ['body'],
        ClassDeclaration: ['id', 'body', 'superClass'],
        ClassExpression: ['id', 'body', 'superClass'],
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DebuggerStatement: [],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        EmptyStatement: [],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'defaults', 'rest', 'body'],
        FunctionExpression: ['id', 'params', 'defaults', 'rest', 'body'],
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        MethodDefinition: ['key', 'value'],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        ObjectPattern: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        ThisExpression: [],
        ThrowStatement: ['argument'],
        TryStatement: ['block', 'handlers', 'handler', 'guardedHandlers', 'finalizer'],
        UnaryExpression: ['argument'],
        UpdateExpression: ['argument'],
        VariableDeclaration: ['declarations'],
        VariableDeclarator: ['id', 'init'],
        WhileStatement: ['test', 'body'],
        WithStatement: ['object', 'body'],
        YieldExpression: ['argument']
    };

    // unique id
    BREAK = {};
    SKIP = {};

    VisitorOption = {
        Break: BREAK,
        Skip: SKIP
    };

    function Reference(parent, key) {
        this.parent = parent;
        this.key = key;
    }

    Reference.prototype.replace = function replace(node) {
        this.parent[this.key] = node;
    };

    function Element(node, path, wrap, ref) {
        this.node = node;
        this.path = path;
        this.wrap = wrap;
        this.ref = ref;
    }

    function Controller() { }

    // API:
    // return property path array from root to current node
    Controller.prototype.path = function path() {
        var i, iz, j, jz, result, element;

        function addToPath(result, path) {
            if (isArray(path)) {
                for (j = 0, jz = path.length; j < jz; ++j) {
                    result.push(path[j]);
                }
            } else {
                result.push(path);
            }
        }

        // root node
        if (!this.__current.path) {
            return null;
        }

        // first node is sentinel, second node is root element
        result = [];
        for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
            element = this.__leavelist[i];
            addToPath(result, element.path);
        }
        addToPath(result, this.__current.path);
        return result;
    };

    // API:
    // return array of parent elements
    Controller.prototype.parents = function parents() {
        var i, iz, result;

        // first node is sentinel
        result = [];
        for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
            result.push(this.__leavelist[i].node);
        }

        return result;
    };

    // API:
    // return current node
    Controller.prototype.current = function current() {
        return this.__current.node;
    };

    Controller.prototype.__execute = function __execute(callback, element) {
        var previous, result;

        result = undefined;

        previous  = this.__current;
        this.__current = element;
        this.__state = null;
        if (callback) {
            result = callback.call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
        }
        this.__current = previous;

        return result;
    };

    // API:
    // notify control skip / break
    Controller.prototype.notify = function notify(flag) {
        this.__state = flag;
    };

    // API:
    // skip child nodes of current node
    Controller.prototype.skip = function () {
        this.notify(SKIP);
    };

    // API:
    // break traversals
    Controller.prototype['break'] = function () {
        this.notify(BREAK);
    };

    Controller.prototype.__initialize = function(root, visitor) {
        this.visitor = visitor;
        this.root = root;
        this.__worklist = [];
        this.__leavelist = [];
        this.__current = null;
        this.__state = null;
    };

    Controller.prototype.traverse = function traverse(root, visitor) {
        var worklist,
            leavelist,
            element,
            node,
            nodeType,
            ret,
            key,
            current,
            current2,
            candidates,
            candidate,
            sentinel;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        worklist.push(new Element(root, null, null, null));
        leavelist.push(new Element(null, null, null, null));

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                ret = this.__execute(visitor.leave, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }
                continue;
            }

            if (element.node) {

                ret = this.__execute(visitor.enter, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }

                worklist.push(sentinel);
                leavelist.push(element);

                if (this.__state === SKIP || ret === SKIP) {
                    continue;
                }

                node = element.node;
                nodeType = element.wrap || node.type;
                candidates = VisitorKeys[nodeType];

                current = candidates.length;
                while ((current -= 1) >= 0) {
                    key = candidates[current];
                    candidate = node[key];
                    if (!candidate) {
                        continue;
                    }

                    if (!isArray(candidate)) {
                        worklist.push(new Element(candidate, key, null, null));
                        continue;
                    }

                    current2 = candidate.length;
                    while ((current2 -= 1) >= 0) {
                        if (!candidate[current2]) {
                            continue;
                        }
                        if ((nodeType === Syntax.ObjectExpression || nodeType === Syntax.ObjectPattern) && 'properties' === candidates[current]) {
                            element = new Element(candidate[current2], [key, current2], 'Property', null);
                        } else {
                            element = new Element(candidate[current2], [key, current2], null, null);
                        }
                        worklist.push(element);
                    }
                }
            }
        }
    };

    Controller.prototype.replace = function replace(root, visitor) {
        var worklist,
            leavelist,
            node,
            nodeType,
            target,
            element,
            current,
            current2,
            candidates,
            candidate,
            sentinel,
            outer,
            key;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        outer = {
            root: root
        };
        element = new Element(root, null, null, new Reference(outer, 'root'));
        worklist.push(element);
        leavelist.push(element);

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                target = this.__execute(visitor.leave, element);

                // node may be replaced with null,
                // so distinguish between undefined and null in this place
                if (target !== undefined && target !== BREAK && target !== SKIP) {
                    // replace
                    element.ref.replace(target);
                }

                if (this.__state === BREAK || target === BREAK) {
                    return outer.root;
                }
                continue;
            }

            target = this.__execute(visitor.enter, element);

            // node may be replaced with null,
            // so distinguish between undefined and null in this place
            if (target !== undefined && target !== BREAK && target !== SKIP) {
                // replace
                element.ref.replace(target);
                element.node = target;
            }

            if (this.__state === BREAK || target === BREAK) {
                return outer.root;
            }

            // node may be null
            node = element.node;
            if (!node) {
                continue;
            }

            worklist.push(sentinel);
            leavelist.push(element);

            if (this.__state === SKIP || target === SKIP) {
                continue;
            }

            nodeType = element.wrap || node.type;
            candidates = VisitorKeys[nodeType];

            current = candidates.length;
            while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = node[key];
                if (!candidate) {
                    continue;
                }

                if (!isArray(candidate)) {
                    worklist.push(new Element(candidate, key, null, new Reference(node, key)));
                    continue;
                }

                current2 = candidate.length;
                while ((current2 -= 1) >= 0) {
                    if (!candidate[current2]) {
                        continue;
                    }
                    if (nodeType === Syntax.ObjectExpression && 'properties' === candidates[current]) {
                        element = new Element(candidate[current2], [key, current2], 'Property', new Reference(candidate, current2));
                    } else {
                        element = new Element(candidate[current2], [key, current2], null, new Reference(candidate, current2));
                    }
                    worklist.push(element);
                }
            }
        }

        return outer.root;
    };

    function traverse(root, visitor) {
        var controller = new Controller();
        return controller.traverse(root, visitor);
    }

    function replace(root, visitor) {
        var controller = new Controller();
        return controller.replace(root, visitor);
    }

    function extendCommentRange(comment, tokens) {
        var target;

        target = upperBound(tokens, function search(token) {
            return token.range[0] > comment.range[0];
        });

        comment.extendedRange = [comment.range[0], comment.range[1]];

        if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
        }

        target -= 1;
        if (target >= 0) {
            comment.extendedRange[0] = tokens[target].range[1];
        }

        return comment;
    }

    function attachComments(tree, providedComments, tokens) {
        // At first, we should calculate extended comment ranges.
        var comments = [], comment, len, i, cursor;

        if (!tree.range) {
            throw new Error('attachComments needs range information');
        }

        // tokens array is empty, we attach comments to tree as 'leadingComments'
        if (!tokens.length) {
            if (providedComments.length) {
                for (i = 0, len = providedComments.length; i < len; i += 1) {
                    comment = deepCopy(providedComments[i]);
                    comment.extendedRange = [0, tree.range[0]];
                    comments.push(comment);
                }
                tree.leadingComments = comments;
            }
            return tree;
        }

        for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
        }

        // This is based on John Freeman's implementation.
        cursor = 0;
        traverse(tree, {
            enter: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (comment.extendedRange[1] > node.range[0]) {
                        break;
                    }

                    if (comment.extendedRange[1] === node.range[0]) {
                        if (!node.leadingComments) {
                            node.leadingComments = [];
                        }
                        node.leadingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        cursor = 0;
        traverse(tree, {
            leave: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (node.range[1] < comment.extendedRange[0]) {
                        break;
                    }

                    if (node.range[1] === comment.extendedRange[0]) {
                        if (!node.trailingComments) {
                            node.trailingComments = [];
                        }
                        node.trailingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        return tree;
    }

    exports.version = '1.3.3-dev';
    exports.Syntax = Syntax;
    exports.traverse = traverse;
    exports.replace = replace;
    exports.attachComments = attachComments;
    exports.VisitorKeys = VisitorKeys;
    exports.VisitorOption = VisitorOption;
    exports.Controller = Controller;
}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],9:[function(_dereq_,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var Regex;

    // See also tools/generate-unicode-regex.py.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]'),
        NonAsciiIdentifierPart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]')
    };

    function isDecimalDigit(ch) {
        return (ch >= 48 && ch <= 57);   // 0..9
    }

    function isHexDigit(ch) {
        return isDecimalDigit(ch) || (97 <= ch && ch <= 102) || (65 <= ch && ch <= 70);
    }

    function isOctalDigit(ch) {
        return (ch >= 48 && ch <= 55);   // 0..7
    }

    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === 0x20) || (ch === 0x09) || (ch === 0x0B) || (ch === 0x0C) || (ch === 0xA0) ||
            (ch >= 0x1680 && [0x1680, 0x180E, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000, 0xFEFF].indexOf(ch) >= 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === 0x0A) || (ch === 0x0D) || (ch === 0x2028) || (ch === 0x2029);
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch)));
    }

    function isIdentifierPart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch >= 48 && ch <= 57) ||         // 0..9
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch)));
    }

    module.exports = {
        isDecimalDigit: isDecimalDigit,
        isHexDigit: isHexDigit,
        isOctalDigit: isOctalDigit,
        isWhiteSpace: isWhiteSpace,
        isLineTerminator: isLineTerminator,
        isIdentifierStart: isIdentifierStart,
        isIdentifierPart: isIdentifierPart
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],10:[function(_dereq_,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var code = _dereq_('./code');

    function isStrictModeReservedWordES6(id) {
        switch (id) {
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'let':
            return true;
        default:
            return false;
        }
    }

    function isKeywordES5(id, strict) {
        // yield should not be treated as keyword under non-strict mode.
        if (!strict && id === 'yield') {
            return false;
        }
        return isKeywordES6(id, strict);
    }

    function isKeywordES6(id, strict) {
        if (strict && isStrictModeReservedWordES6(id)) {
            return true;
        }

        switch (id.length) {
        case 2:
            return (id === 'if') || (id === 'in') || (id === 'do');
        case 3:
            return (id === 'var') || (id === 'for') || (id === 'new') || (id === 'try');
        case 4:
            return (id === 'this') || (id === 'else') || (id === 'case') ||
                (id === 'void') || (id === 'with') || (id === 'enum');
        case 5:
            return (id === 'while') || (id === 'break') || (id === 'catch') ||
                (id === 'throw') || (id === 'const') || (id === 'yield') ||
                (id === 'class') || (id === 'super');
        case 6:
            return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                (id === 'switch') || (id === 'export') || (id === 'import');
        case 7:
            return (id === 'default') || (id === 'finally') || (id === 'extends');
        case 8:
            return (id === 'function') || (id === 'continue') || (id === 'debugger');
        case 10:
            return (id === 'instanceof');
        default:
            return false;
        }
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    function isIdentifierName(id) {
        var i, iz, ch;

        if (id.length === 0) {
            return false;
        }

        ch = id.charCodeAt(0);
        if (!code.isIdentifierStart(ch) || ch === 92) {  // \ (backslash)
            return false;
        }

        for (i = 1, iz = id.length; i < iz; ++i) {
            ch = id.charCodeAt(i);
            if (!code.isIdentifierPart(ch) || ch === 92) {  // \ (backslash)
                return false;
            }
        }
        return true;
    }

    module.exports = {
        isKeywordES5: isKeywordES5,
        isKeywordES6: isKeywordES6,
        isRestrictedWord: isRestrictedWord,
        isIdentifierName: isIdentifierName
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":9}],11:[function(_dereq_,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


(function () {
    'use strict';

    exports.code = _dereq_('./code');
    exports.keyword = _dereq_('./keyword');
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":9,"./keyword":10}],12:[function(_dereq_,module,exports){
module.exports={
  "name": "escodegen",
  "description": "ECMAScript code generator",
  "homepage": "http://github.com/Constellation/escodegen",
  "main": "escodegen.js",
  "bin": {
    "esgenerate": "./bin/esgenerate.js",
    "escodegen": "./bin/escodegen.js"
  },
  "version": "1.2.0",
  "engines": {
    "node": ">=0.4.0"
  },
  "maintainers": [
    {
      "name": "Yusuke Suzuki",
      "email": "utatane.tea@gmail.com",
      "url": "http://github.com/Constellation"
    }
  ],
  "repository": {
    "type": "git",
    "url": "http://github.com/Constellation/escodegen.git"
  },
  "dependencies": {
    "esprima": "~1.0.4",
    "estraverse": "~1.5.0",
    "esutils": "~1.0.0",
    "source-map": "~0.1.30"
  },
  "optionalDependencies": {
    "source-map": "~0.1.30"
  },
  "devDependencies": {
    "esprima-moz": "*",
    "q": "*",
    "bower": "*",
    "semver": "*",
    "chai": "~1.7.2",
    "gulp": "~3.5.0",
    "gulp-mocha": "~0.4.1",
    "gulp-eslint": "~0.1.2",
    "jshint-stylish": "~0.1.5",
    "gulp-jshint": "~1.4.0",
    "commonjs-everywhere": "~0.9.6"
  },
  "licenses": [
    {
      "type": "BSD",
      "url": "http://github.com/Constellation/escodegen/raw/master/LICENSE.BSD"
    }
  ],
  "scripts": {
    "test": "gulp travis",
    "unit-test": "gulp test",
    "lint": "gulp lint",
    "release": "node tools/release.js",
    "build-min": "./node_modules/.bin/cjsify -ma path: tools/entry-point.js > escodegen.browser.min.js",
    "build": "./node_modules/.bin/cjsify -a path: tools/entry-point.js > escodegen.browser.js"
  },
  "readme": "\n### Escodegen [![Build Status](https://secure.travis-ci.org/Constellation/escodegen.png)](http://travis-ci.org/Constellation/escodegen) [![Build Status](https://drone.io/github.com/Constellation/escodegen/status.png)](https://drone.io/github.com/Constellation/escodegen/latest)\n\nEscodegen ([escodegen](http://github.com/Constellation/escodegen)) is\n[ECMAScript](http://www.ecma-international.org/publications/standards/Ecma-262.htm)\n(also popularly known as [JavaScript](http://en.wikipedia.org/wiki/JavaScript>JavaScript))\ncode generator from [Parser API](https://developer.mozilla.org/en/SpiderMonkey/Parser_API) AST.\nSee [online generator demo](http://constellation.github.com/escodegen/demo/index.html).\n\n\n### Install\n\nEscodegen can be used in a web browser:\n\n    <script src=\"escodegen.browser.js\"></script>\n\nescodegen.browser.js is found in tagged-revision. See Tags on GitHub.\n\nOr in a Node.js application via the package manager:\n\n    npm install escodegen\n\n### Usage\n\nA simple example: the program\n\n    escodegen.generate({\n        type: 'BinaryExpression',\n        operator: '+',\n        left: { type: 'Literal', value: 40 },\n        right: { type: 'Literal', value: 2 }\n    });\n\nproduces the string `'40 + 2'`\n\nSee the [API page](https://github.com/Constellation/escodegen/wiki/API) for\noptions. To run the tests, execute `npm test` in the root directory.\n\n### Building browser bundle / minified browser bundle\n\nAt first, executing `npm install` to install the all dev dependencies.\nAfter that,\n\n    npm run-script build\n\nwill generate `escodegen.browser.js`, it is used on the browser environment.\n\nAnd,\n\n    npm run-script build-min\n\nwill generate minified `escodegen.browser.min.js`.\n\n### License\n\n#### Escodegen\n\nCopyright (C) 2012 [Yusuke Suzuki](http://github.com/Constellation)\n (twitter: [@Constellation](http://twitter.com/Constellation)) and other contributors.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n  * Redistributions of source code must retain the above copyright\n    notice, this list of conditions and the following disclaimer.\n\n  * Redistributions in binary form must reproduce the above copyright\n    notice, this list of conditions and the following disclaimer in the\n    documentation and/or other materials provided with the distribution.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE\nARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY\nDIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES\n(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;\nLOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND\nON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\n(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF\nTHIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n\n#### source-map\n\nSourceNodeMocks has a limited interface of mozilla/source-map SourceNode implementations.\n\nCopyright (c) 2009-2011, Mozilla Foundation and contributors\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n* Redistributions of source code must retain the above copyright notice, this\n  list of conditions and the following disclaimer.\n\n* Redistributions in binary form must reproduce the above copyright notice,\n  this list of conditions and the following disclaimer in the documentation\n  and/or other materials provided with the distribution.\n\n* Neither the names of the Mozilla Foundation nor the names of project\n  contributors may be used to endorse or promote products derived from this\n  software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\" AND\nANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED\nWARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE\nFOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\nDAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\nSERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\nCAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\nOR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n",
  "readmeFilename": "README.md",
  "bugs": {
    "url": "https://github.com/Constellation/escodegen/issues"
  },
  "_id": "escodegen@1.2.0",
  "_from": "escodegen@1.2.x"
}

},{}],13:[function(_dereq_,module,exports){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2013 Alex Seville <hi@alexanderseville.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/**
 * Escope (<a href="http://github.com/Constellation/escope">escope</a>) is an <a
 * href="http://www.ecma-international.org/publications/standards/Ecma-262.htm">ECMAScript</a>
 * scope analyzer extracted from the <a
 * href="http://github.com/Constellation/esmangle">esmangle project</a/>.
 * <p>
 * <em>escope</em> finds lexical scopes in a source program, i.e. areas of that
 * program where different occurrences of the same identifier refer to the same
 * variable. With each scope the contained variables are collected, and each
 * identifier reference in code is linked to its corresponding variable (if
 * possible).
 * <p>
 * <em>escope</em> works on a syntax tree of the parsed source code which has
 * to adhere to the <a
 * href="https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API">
 * Mozilla Parser API</a>. E.g. <a href="http://esprima.org">esprima</a> is a parser
 * that produces such syntax trees.
 * <p>
 * The main interface is the {@link analyze} function.
 * @module
 */

/*jslint bitwise:true */
/*global exports:true, define:true, require:true*/
(function (factory, global) {
    'use strict';

    function namespace(str, obj) {
        var i, iz, names, name;
        names = str.split('.');
        for (i = 0, iz = names.length; i < iz; ++i) {
            name = names[i];
            if (obj.hasOwnProperty(name)) {
                obj = obj[name];
            } else {
                obj = (obj[name] = {});
            }
        }
        return obj;
    }

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // and plain browser loading,
    if (typeof define === 'function' && define.amd) {
        define('escope', ['exports', 'estraverse'], function (exports, estraverse) {
            factory(exports, global, estraverse);
        });
    } else if (typeof exports !== 'undefined') {
        factory(exports, global, _dereq_('estraverse'));
    } else {
        factory(namespace('escope', global), global, global.estraverse);
    }
}(function (exports, global, estraverse) {
    'use strict';

    var Syntax,
        Map,
        currentScope,
        globalScope,
        scopes,
        options;

    Syntax = estraverse.Syntax;

    if (typeof global.Map !== 'undefined') {
        // ES6 Map
        Map = global.Map;
    } else {
        Map = function Map() {
            this.__data = {};
        };

        Map.prototype.get = function MapGet(key) {
            key = '$' + key;
            if (this.__data.hasOwnProperty(key)) {
                return this.__data[key];
            }
            return undefined;
        };

        Map.prototype.has = function MapHas(key) {
            key = '$' + key;
            return this.__data.hasOwnProperty(key);
        };

        Map.prototype.set = function MapSet(key, val) {
            key = '$' + key;
            this.__data[key] = val;
        };

        Map.prototype['delete'] = function MapDelete(key) {
            key = '$' + key;
            return delete this.__data[key];
        };
    }

    function assert(cond, text) {
        if (!cond) {
            throw new Error(text);
        }
    }

    function defaultOptions() {
        return {
            optimistic: false,
            directive: false
        };
    }

    function updateDeeply(target, override) {
        var key, val;

        function isHashObject(target) {
            return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
        }

        for (key in override) {
            if (override.hasOwnProperty(key)) {
                val = override[key];
                if (isHashObject(val)) {
                    if (isHashObject(target[key])) {
                        updateDeeply(target[key], val);
                    } else {
                        target[key] = updateDeeply({}, val);
                    }
                } else {
                    target[key] = val;
                }
            }
        }
        return target;
    }

    /**
     * A Reference represents a single occurrence of an identifier in code.
     * @class Reference
     */
    function Reference(ident, scope, flag, writeExpr, maybeImplicitGlobal) {
        /** 
         * Identifier syntax node.
         * @member {esprima#Identifier} Reference#identifier 
         */
        this.identifier = ident;
        /** 
         * Reference to the enclosing Scope.
         * @member {Scope} Reference#from 
         */
        this.from = scope;
        /**
         * Whether the reference comes from a dynamic scope (such as 'eval',
         * 'with', etc.), and may be trapped by dynamic scopes.
         * @member {boolean} Reference#tainted
         */
        this.tainted = false;
        /** 
         * The variable this reference is resolved with.
         * @member {Variable} Reference#resolved 
         */
        this.resolved = null;
        /** 
         * The read-write mode of the reference. (Value is one of {@link
         * Reference.READ}, {@link Reference.RW}, {@link Reference.WRITE}).
         * @member {number} Reference#flag 
         * @private
         */
        this.flag = flag;
        if (this.isWrite()) {
            /** 
             * If reference is writeable, this is the tree being written to it.
             * @member {esprima#Node} Reference#writeExpr 
             */
            this.writeExpr = writeExpr;
        }
        /** 
         * Whether the Reference might refer to a global variable.
         * @member {boolean} Reference#__maybeImplicitGlobal 
         * @private
         */
        this.__maybeImplicitGlobal = maybeImplicitGlobal;
    }

    /** 
     * @constant Reference.READ 
     * @private
     */
    Reference.READ = 0x1;
    /** 
     * @constant Reference.WRITE 
     * @private
     */
    Reference.WRITE = 0x2;
    /** 
     * @constant Reference.RW 
     * @private
     */
    Reference.RW = 0x3;

    /**
     * Whether the reference is static.
     * @method Reference#isStatic
     * @return {boolean}
     */
    Reference.prototype.isStatic = function isStatic() {
        return !this.tainted && this.resolved && this.resolved.scope.isStatic();
    };

    /**
     * Whether the reference is writeable.
     * @method Reference#isWrite
     * @return {boolean}
     */
    Reference.prototype.isWrite = function isWrite() {
        return this.flag & Reference.WRITE;
    };

    /**
     * Whether the reference is readable.
     * @method Reference#isRead
     * @return {boolean}
     */
    Reference.prototype.isRead = function isRead() {
        return this.flag & Reference.READ;
    };

    /**
     * Whether the reference is read-only.
     * @method Reference#isReadOnly
     * @return {boolean}
     */
    Reference.prototype.isReadOnly = function isReadOnly() {
        return this.flag === Reference.READ;
    };

    /**
     * Whether the reference is write-only.
     * @method Reference#isWriteOnly
     * @return {boolean}
     */
    Reference.prototype.isWriteOnly = function isWriteOnly() {
        return this.flag === Reference.WRITE;
    };

    /**
     * Whether the reference is read-write.
     * @method Reference#isReadWrite
     * @return {boolean}
     */
    Reference.prototype.isReadWrite = function isReadWrite() {
        return this.flag === Reference.RW;
    };

    /**
     * A Variable represents a locally scoped identifier. These include arguments to
     * functions.
     * @class Variable
     */
    function Variable(name, scope) {
        /**  
         * The variable name, as given in the source code.
         * @member {String} Variable#name 
         */
        this.name = name;
        /**
         * List of defining occurrences of this variable (like in 'var ...'
         * statements or as parameter), as AST nodes.
         * @member {esprima.Identifier[]} Variable#identifiers
         */
        this.identifiers = [];
        /**
         * List of {@link Reference|references} of this variable (excluding parameter entries)
         * in its defining scope and all nested scopes. For defining
         * occurrences only see {@link Variable#defs}.
         * @member {Reference[]} Variable#references
         */
        this.references = [];

        /**
         * List of defining occurrences of this variable (like in 'var ...'
         * statements or as parameter), as custom objects.
         * @typedef {Object} DefEntry
         * @property {String} DefEntry.type - the type of the occurrence (e.g.
         *      "Parameter", "Variable", ...)
         * @property {esprima.Identifier} DefEntry.name - the identifier AST node of the occurrence
         * @property {esprima.Node} DefEntry.node - the enclosing node of the
         *      identifier
         * @property {esprima.Node} [DefEntry.parent] - the enclosing statement
         *      node of the identifier
         * @member {DefEntry[]} Variable#defs
         */
        this.defs = [];

        this.tainted = false;
        /**
         * Whether this is a stack variable.
         * @member {boolean} Variable#stack
         */
        this.stack = true;
        /** 
         * Reference to the enclosing Scope.
         * @member {Scope} Variable#scope 
         */
        this.scope = scope;
    }

    Variable.CatchClause = 'CatchClause';
    Variable.Parameter = 'Parameter';
    Variable.FunctionName = 'FunctionName';
    Variable.Variable = 'Variable';
    Variable.ImplicitGlobalVariable = 'ImplicitGlobalVariable';

    function isStrictScope(scope, block) {
        var body, i, iz, stmt, expr;

        // When upper scope is exists and strict, inner scope is also strict.
        if (scope.upper && scope.upper.isStrict) {
            return true;
        }

        if (scope.type === 'function') {
            body = block.body;
        } else if (scope.type === 'global') {
            body = block;
        } else {
            return false;
        }

        if (options.directive) {
            for (i = 0, iz = body.body.length; i < iz; ++i) {
                stmt = body.body[i];
                if (stmt.type !== 'DirectiveStatement') {
                    break;
                }
                if (stmt.raw === '"use strict"' || stmt.raw === '\'use strict\'') {
                    return true;
                }
            }
        } else {
            for (i = 0, iz = body.body.length; i < iz; ++i) {
                stmt = body.body[i];
                if (stmt.type !== Syntax.ExpressionStatement) {
                    break;
                }
                expr = stmt.expression;
                if (expr.type !== Syntax.Literal || typeof expr.value !== 'string') {
                    break;
                }
                if (expr.raw != null) {
                    if (expr.raw === '"use strict"' || expr.raw === '\'use strict\'') {
                        return true;
                    }
                } else {
                    if (expr.value === 'use strict') {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * @class Scope
     */
    function Scope(block, opt) {
        var variable, body;

        /**
         * One of 'catch', 'with', 'function' or 'global'.
         * @member {String} Scope#type
         */
        this.type =
            (block.type === Syntax.CatchClause) ? 'catch' :
            (block.type === Syntax.WithStatement) ? 'with' :
            (block.type === Syntax.Program) ? 'global' : 'function';
         /**
         * The scoped {@link Variable}s of this scope, as <code>{ Variable.name
         * : Variable }</code>.
         * @member {Map} Scope#set
         */
        this.set = new Map();
        /**
         * The tainted variables of this scope, as <code>{ Variable.name :
         * boolean }</code>.
         * @member {Map} Scope#taints */
        this.taints = new Map();
        /**
         * Generally, through the lexical scoping of JS you can always know
         * which variable an identifier in the source code refers to. There are
         * a few exceptions to this rule. With 'global' and 'with' scopes you
         * can only decide at runtime which variable a reference refers to.
         * Moreover, if 'eval()' is used in a scope, it might introduce new
         * bindings in this or its prarent scopes.
         * All those scopes are considered 'dynamic'.
         * @member {boolean} Scope#dynamic
         */
        this.dynamic = this.type === 'global' || this.type === 'with';
        /**
         * A reference to the scope-defining syntax node.
         * @member {esprima.Node} Scope#block
         */
        this.block = block;
         /**
         * The {@link Reference|references} that are not resolved with this scope.
         * @member {Reference[]} Scope#through
         */
        this.through = [];
         /**
         * The scoped {@link Variable}s of this scope. In the case of a
         * 'function' scope this includes the automatic argument <em>arguments</em> as
         * its first element, as well as all further formal arguments.
         * @member {Variable[]} Scope#variables
         */
        this.variables = [];
         /**
         * Any variable {@link Reference|reference} found in this scope. This
         * includes occurrences of local variables as well as variables from
         * parent scopes (including the global scope). For local variables
         * this also includes defining occurrences (like in a 'var' statement).
         * In a 'function' scope this does not include the occurrences of the
         * formal parameter in the parameter list.
         * @member {Reference[]} Scope#references
         */
        this.references = [];
         /**
         * List of {@link Reference}s that are left to be resolved (i.e. which
         * need to be linked to the variable they refer to). Used internally to
         * resolve bindings during scope analysis. On a finalized scope
         * analysis, all sopes have <em>left</em> value <strong>null</strong>.
         * @member {Reference[]} Scope#left
         */
        this.left = [];
         /**
         * For 'global' and 'function' scopes, this is a self-reference. For
         * other scope types this is the <em>variableScope</em> value of the
         * parent scope.
         * @member {Scope} Scope#variableScope
         */
        this.variableScope =
            (this.type === 'global' || this.type === 'function') ? this : currentScope.variableScope;
         /**
         * Whether this scope is created by a FunctionExpression.
         * @member {boolean} Scope#functionExpressionScope
         */
        this.functionExpressionScope = false;
         /**
         * Whether this is a scope that contains an 'eval()' invocation.
         * @member {boolean} Scope#directCallToEvalScope
         */
        this.directCallToEvalScope = false;
         /**
         * @member {boolean} Scope#thisFound
         */
        this.thisFound = false;
        body = this.type === 'function' ? block.body : block;
        if (opt.naming) {
            this.__define(block.id, {
                type: Variable.FunctionName,
                name: block.id,
                node: block
            });
            this.functionExpressionScope = true;
        } else {
            if (this.type === 'function') {
                variable = new Variable('arguments', this);
                this.taints.set('arguments', true);
                this.set.set('arguments', variable);
                this.variables.push(variable);
            }

            if (block.type === Syntax.FunctionExpression && block.id) {
                new Scope(block, { naming: true });
            }
        }

         /**
         * Reference to the parent {@link Scope|scope}.
         * @member {Scope} Scope#upper
         */
        this.upper = currentScope;
         /**
         * Whether 'use strict' is in effect in this scope.
         * @member {boolean} Scope#isStrict
         */
        this.isStrict = isStrictScope(this, block);

         /**
         * List of nested {@link Scope}s.
         * @member {Scope[]} Scope#childScopes
         */
        this.childScopes = [];
        if (currentScope) {
            currentScope.childScopes.push(this);
        }


        // RAII
        currentScope = this;
        if (this.type === 'global') {
            globalScope = this;
            globalScope.implicit = {
                set: new Map(),
                variables: []
            };
        }
        scopes.push(this);
    }

    Scope.prototype.__close = function __close() {
        var i, iz, ref, current, node, implicit;

        // Because if this is global environment, upper is null
        if (!this.dynamic || options.optimistic) {
            // static resolve
            for (i = 0, iz = this.left.length; i < iz; ++i) {
                ref = this.left[i];
                if (!this.__resolve(ref)) {
                    this.__delegateToUpperScope(ref);
                }
            }
        } else {
            // this is "global" / "with" / "function with eval" environment
            if (this.type === 'with') {
                for (i = 0, iz = this.left.length; i < iz; ++i) {
                    ref = this.left[i];
                    ref.tainted = true;
                    this.__delegateToUpperScope(ref);
                }
            } else {
                for (i = 0, iz = this.left.length; i < iz; ++i) {
                    // notify all names are through to global
                    ref = this.left[i];
                    current = this;
                    do {
                        current.through.push(ref);
                        current = current.upper;
                    } while (current);
                }
            }
        }

        if (this.type === 'global') {
            implicit = [];
            for (i = 0, iz = this.left.length; i < iz; ++i) {
                ref = this.left[i];
                if (ref.__maybeImplicitGlobal && !this.set.has(ref.identifier.name)) {
                    implicit.push(ref.__maybeImplicitGlobal);
                }
            }

            // create an implicit global variable from assignment expression
            for (i = 0, iz = implicit.length; i < iz; ++i) {
                node = implicit[i];
                this.__defineImplicit(node.left, {
                    type: Variable.ImplicitGlobalVariable,
                    name: node.left,
                    node: node
                });
            }
        }

        this.left = null;
        currentScope = this.upper;
    };

    Scope.prototype.__resolve = function __resolve(ref) {
        var variable, name;
        name = ref.identifier.name;
        if (this.set.has(name)) {
            variable = this.set.get(name);
            variable.references.push(ref);
            variable.stack = variable.stack && ref.from.variableScope === this.variableScope;
            if (ref.tainted) {
                variable.tainted = true;
                this.taints.set(variable.name, true);
            }
            ref.resolved = variable;
            return true;
        }
        return false;
    };

    Scope.prototype.__delegateToUpperScope = function __delegateToUpperScope(ref) {
        if (this.upper) {
            this.upper.left.push(ref);
        }
        this.through.push(ref);
    };

    Scope.prototype.__defineImplicit = function __defineImplicit(node, info) {
        var name, variable;
        if (node && node.type === Syntax.Identifier) {
            name = node.name;
            if (!this.implicit.set.has(name)) {
                variable = new Variable(name, this);
                variable.identifiers.push(node);
                variable.defs.push(info);
                this.implicit.set.set(name, variable);
                this.implicit.variables.push(variable);
            } else {
                variable = this.implicit.set.get(name);
                variable.identifiers.push(node);
                variable.defs.push(info);
            }
        }
    };

    Scope.prototype.__define = function __define(node, info) {
        var name, variable;
        if (node && node.type === Syntax.Identifier) {
            name = node.name;
            if (!this.set.has(name)) {
                variable = new Variable(name, this);
                variable.identifiers.push(node);
                variable.defs.push(info);
                this.set.set(name, variable);
                this.variables.push(variable);
            } else {
                variable = this.set.get(name);
                variable.identifiers.push(node);
                variable.defs.push(info);
            }
        }
    };

    Scope.prototype.__referencing = function __referencing(node, assign, writeExpr, maybeImplicitGlobal) {
        var ref;
        // because Array element may be null
        if (node && node.type === Syntax.Identifier) {
            ref = new Reference(node, this, assign || Reference.READ, writeExpr, maybeImplicitGlobal);
            this.references.push(ref);
            this.left.push(ref);
        }
    };

    Scope.prototype.__detectEval = function __detectEval() {
        var current;
        current = this;
        this.directCallToEvalScope = true;
        do {
            current.dynamic = true;
            current = current.upper;
        } while (current);
    };

    Scope.prototype.__detectThis = function __detectThis() {
        this.thisFound = true;
    };

    Scope.prototype.__isClosed = function isClosed() {
        return this.left === null;
    };

    // API Scope#resolve(name)
    // returns resolved reference
    Scope.prototype.resolve = function resolve(ident) {
        var ref, i, iz;
        assert(this.__isClosed(), 'scope should be closed');
        assert(ident.type === Syntax.Identifier, 'target should be identifier');
        for (i = 0, iz = this.references.length; i < iz; ++i) {
            ref = this.references[i];
            if (ref.identifier === ident) {
                return ref;
            }
        }
        return null;
    };

    // API Scope#isStatic
    // returns this scope is static
    Scope.prototype.isStatic = function isStatic() {
        return !this.dynamic;
    };

    // API Scope#isArgumentsMaterialized
    // return this scope has materialized arguments
    Scope.prototype.isArgumentsMaterialized = function isArgumentsMaterialized() {
        // TODO(Constellation)
        // We can more aggressive on this condition like this.
        //
        // function t() {
        //     // arguments of t is always hidden.
        //     function arguments() {
        //     }
        // }
        var variable;

        // This is not function scope
        if (this.type !== 'function') {
            return true;
        }

        if (!this.isStatic()) {
            return true;
        }

        variable = this.set.get('arguments');
        assert(variable, 'always have arguments variable');
        return variable.tainted || variable.references.length  !== 0;
    };

    // API Scope#isThisMaterialized
    // return this scope has materialized `this` reference
    Scope.prototype.isThisMaterialized = function isThisMaterialized() {
        // This is not function scope
        if (this.type !== 'function') {
            return true;
        }
        if (!this.isStatic()) {
            return true;
        }
        return this.thisFound;
    };

    Scope.mangledName = '__$escope$__';

    Scope.prototype.attach = function attach() {
        if (!this.functionExpressionScope) {
            this.block[Scope.mangledName] = this;
        }
    };

    Scope.prototype.detach = function detach() {
        if (!this.functionExpressionScope) {
            delete this.block[Scope.mangledName];
        }
    };

    Scope.prototype.isUsedName = function (name) {
        if (this.set.has(name)) {
            return true;
        }
        for (var i = 0, iz = this.through.length; i < iz; ++i) {
            if (this.through[i].identifier.name === name) {
                return true;
            }
        }
        return false;
    };

    /**
     * @class ScopeManager
     */
    function ScopeManager(scopes) {
        this.scopes = scopes;
        this.attached = false;
    }

    // Returns appropliate scope for this node
    ScopeManager.prototype.__get = function __get(node) {
        var i, iz, scope;
        if (this.attached) {
            return node[Scope.mangledName] || null;
        }
        if (Scope.isScopeRequired(node)) {
            for (i = 0, iz = this.scopes.length; i < iz; ++i) {
                scope = this.scopes[i];
                if (!scope.functionExpressionScope) {
                    if (scope.block === node) {
                        return scope;
                    }
                }
            }
        }
        return null;
    };

    ScopeManager.prototype.acquire = function acquire(node) {
        return this.__get(node);
    };

    ScopeManager.prototype.release = function release(node) {
        var scope = this.__get(node);
        if (scope) {
            scope = scope.upper;
            while (scope) {
                if (!scope.functionExpressionScope) {
                    return scope;
                }
                scope = scope.upper;
            }
        }
        return null;
    };

    ScopeManager.prototype.attach = function attach() {
        var i, iz;
        for (i = 0, iz = this.scopes.length; i < iz; ++i) {
            this.scopes[i].attach();
        }
        this.attached = true;
    };

    ScopeManager.prototype.detach = function detach() {
        var i, iz;
        for (i = 0, iz = this.scopes.length; i < iz; ++i) {
            this.scopes[i].detach();
        }
        this.attached = false;
    };

    Scope.isScopeRequired = function isScopeRequired(node) {
        return Scope.isVariableScopeRequired(node) || node.type === Syntax.WithStatement || node.type === Syntax.CatchClause;
    };

    Scope.isVariableScopeRequired = function isVariableScopeRequired(node) {
        return node.type === Syntax.Program || node.type === Syntax.FunctionExpression || node.type === Syntax.FunctionDeclaration;
    };

    /**
     * Main interface function. Takes an Esprima syntax tree and returns the
     * analyzed scopes.
     * @function analyze
     * @param {esprima.Tree} tree
     * @param {Object} providedOptions - Options that tailor the scope analysis
     * @param {boolean} [providedOptions.optimistic=false] - the optimistic flag
     * @param {boolean} [providedOptions.directive=false]- the directive flag
     * @param {boolean} [providedOptions.ignoreEval=false]- whether to check 'eval()' calls
     * @return {ScopeManager}
     */
    function analyze(tree, providedOptions) {
        var resultScopes;

        options = updateDeeply(defaultOptions(), providedOptions);
        resultScopes = scopes = [];
        currentScope = null;
        globalScope = null;

        // attach scope and collect / resolve names
        estraverse.traverse(tree, {
            enter: function enter(node) {
                var i, iz, decl;
                if (Scope.isScopeRequired(node)) {
                    new Scope(node, {});
                }

                switch (node.type) {
                case Syntax.AssignmentExpression:
                    if (node.operator === '=') {
                        currentScope.__referencing(node.left, Reference.WRITE, node.right, (!currentScope.isStrict && node.left.name != null) && node);
                    } else {
                        currentScope.__referencing(node.left, Reference.RW, node.right);
                    }
                    currentScope.__referencing(node.right);
                    break;

                case Syntax.ArrayExpression:
                    for (i = 0, iz = node.elements.length; i < iz; ++i) {
                        currentScope.__referencing(node.elements[i]);
                    }
                    break;

                case Syntax.BlockStatement:
                    break;

                case Syntax.BinaryExpression:
                    currentScope.__referencing(node.left);
                    currentScope.__referencing(node.right);
                    break;

                case Syntax.BreakStatement:
                    break;

                case Syntax.CallExpression:
                    currentScope.__referencing(node.callee);
                    for (i = 0, iz = node['arguments'].length; i < iz; ++i) {
                        currentScope.__referencing(node['arguments'][i]);
                    }

                    // check this is direct call to eval
                    if (!options.ignoreEval && node.callee.type === Syntax.Identifier && node.callee.name === 'eval') {
                        currentScope.variableScope.__detectEval();
                    }
                    break;

                case Syntax.CatchClause:
                    currentScope.__define(node.param, {
                        type: Variable.CatchClause,
                        name: node.param,
                        node: node
                    });
                    break;

                case Syntax.ConditionalExpression:
                    currentScope.__referencing(node.test);
                    currentScope.__referencing(node.consequent);
                    currentScope.__referencing(node.alternate);
                    break;

                case Syntax.ContinueStatement:
                    break;

                case Syntax.DirectiveStatement:
                    break;

                case Syntax.DoWhileStatement:
                    currentScope.__referencing(node.test);
                    break;

                case Syntax.DebuggerStatement:
                    break;

                case Syntax.EmptyStatement:
                    break;

                case Syntax.ExpressionStatement:
                    currentScope.__referencing(node.expression);
                    break;

                case Syntax.ForStatement:
                    currentScope.__referencing(node.init);
                    currentScope.__referencing(node.test);
                    currentScope.__referencing(node.update);
                    break;

                case Syntax.ForInStatement:
                    if (node.left.type === Syntax.VariableDeclaration) {
                        currentScope.__referencing(node.left.declarations[0].id, Reference.WRITE, null, false);
                    } else {
                        currentScope.__referencing(node.left, Reference.WRITE, null, (!currentScope.isStrict && node.left.name != null) && node);
                    }
                    currentScope.__referencing(node.right);
                    break;

                case Syntax.FunctionDeclaration:
                    // FunctionDeclaration name is defined in upper scope
                    currentScope.upper.__define(node.id, {
                        type: Variable.FunctionName,
                        name: node.id,
                        node: node
                    });
                    for (i = 0, iz = node.params.length; i < iz; ++i) {
                        currentScope.__define(node.params[i], {
                            type: Variable.Parameter,
                            name: node.params[i],
                            node: node,
                            index: i
                        });
                    }
                    break;

                case Syntax.FunctionExpression:
                    // id is defined in upper scope
                    for (i = 0, iz = node.params.length; i < iz; ++i) {
                        currentScope.__define(node.params[i], {
                            type: Variable.Parameter,
                            name: node.params[i],
                            node: node,
                            index: i
                        });
                    }
                    break;

                case Syntax.Identifier:
                    break;

                case Syntax.IfStatement:
                    currentScope.__referencing(node.test);
                    break;

                case Syntax.Literal:
                    break;

                case Syntax.LabeledStatement:
                    break;

                case Syntax.LogicalExpression:
                    currentScope.__referencing(node.left);
                    currentScope.__referencing(node.right);
                    break;

                case Syntax.MemberExpression:
                    currentScope.__referencing(node.object);
                    if (node.computed) {
                        currentScope.__referencing(node.property);
                    }
                    break;

                case Syntax.NewExpression:
                    currentScope.__referencing(node.callee);
                    for (i = 0, iz = node['arguments'].length; i < iz; ++i) {
                        currentScope.__referencing(node['arguments'][i]);
                    }
                    break;

                case Syntax.ObjectExpression:
                    break;

                case Syntax.Program:
                    break;

                case Syntax.Property:
                    currentScope.__referencing(node.value);
                    break;

                case Syntax.ReturnStatement:
                    currentScope.__referencing(node.argument);
                    break;

                case Syntax.SequenceExpression:
                    for (i = 0, iz = node.expressions.length; i < iz; ++i) {
                        currentScope.__referencing(node.expressions[i]);
                    }
                    break;

                case Syntax.SwitchStatement:
                    currentScope.__referencing(node.discriminant);
                    break;

                case Syntax.SwitchCase:
                    currentScope.__referencing(node.test);
                    break;

                case Syntax.ThisExpression:
                    currentScope.variableScope.__detectThis();
                    break;

                case Syntax.ThrowStatement:
                    currentScope.__referencing(node.argument);
                    break;

                case Syntax.TryStatement:
                    break;

                case Syntax.UnaryExpression:
                    currentScope.__referencing(node.argument);
                    break;

                case Syntax.UpdateExpression:
                    currentScope.__referencing(node.argument, Reference.RW, null);
                    break;

                case Syntax.VariableDeclaration:
                    for (i = 0, iz = node.declarations.length; i < iz; ++i) {
                        decl = node.declarations[i];
                        currentScope.variableScope.__define(decl.id, {
                            type: Variable.Variable,
                            name: decl.id,
                            node: decl,
                            index: i,
                            parent: node
                        });
                        if (decl.init) {
                            // initializer is found
                            currentScope.__referencing(decl.id, Reference.WRITE, decl.init, false);
                            currentScope.__referencing(decl.init);
                        }
                    }
                    break;

                case Syntax.VariableDeclarator:
                    break;

                case Syntax.WhileStatement:
                    currentScope.__referencing(node.test);
                    break;

                case Syntax.WithStatement:
                    // WithStatement object is referenced at upper scope
                    currentScope.upper.__referencing(node.object);
                    break;
                }
            },

            leave: function leave(node) {
                while (currentScope && node === currentScope.block) {
                    currentScope.__close();
                }
            }
        });

        assert(currentScope === null);
        globalScope = null;
        scopes = null;
        options = null;

        return new ScopeManager(resultScopes);
    }

    /** @name module:escope.version */
    exports.version = '1.0.1';
    /** @name module:escope.Reference */
    exports.Reference = Reference;
    /** @name module:escope.Variable */
    exports.Variable = Variable;
    /** @name module:escope.Scope */
    exports.Scope = Scope;
    /** @name module:escope.ScopeManager */
    exports.ScopeManager = ScopeManager;
    /** @name module:escope.analyze */
    exports.analyze = analyze;
}, this));
/* vim: set sw=4 ts=4 et tw=80 : */

},{"estraverse":14}],14:[function(_dereq_,module,exports){
module.exports=_dereq_(8)
},{}],15:[function(_dereq_,module,exports){

},{}],16:[function(_dereq_,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,_dereq_("JkpR2F"))
},{"JkpR2F":17}],17:[function(_dereq_,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],18:[function(_dereq_,module,exports){
module.exports = function () {
    // see https://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
    var origPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = function (_, stack) { return stack };
    var stack = (new Error()).stack;
    Error.prepareStackTrace = origPrepareStackTrace;
    return stack[2].getFileName();
};

},{}],19:[function(_dereq_,module,exports){
module.exports = _dereq_('./core.json').reduce(function (acc, x) {
    acc[x] = true;
    return acc;
}, {});

},{"./core.json":20}],20:[function(_dereq_,module,exports){
module.exports=[
    "assert",
    "buffer_ieee754",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "_debugger",
    "dgram",
    "dns",
    "domain",
    "events",
    "freelist",
    "fs",
    "http",
    "https",
    "_linklist",
    "module",
    "net",
    "os",
    "path",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "sys",
    "timers",
    "tls",
    "tty",
    "url",
    "util",
    "vm",
    "zlib"
]

},{}],21:[function(_dereq_,module,exports){
(function (process){
var path = _dereq_('path');


module.exports = function (start, opts) {
    var modules = opts.moduleDirectory || 'node_modules';
    var prefix = '/';
    if (/^([A-Za-z]:)/.test(start)) {
        prefix = '';
    } else if (/^\\\\/.test(start)) {
        prefix = '\\\\';
    }
    var splitRe = process.platform === 'win32' ? /[\/\\]/ : /\/+/;
    var parts = start.split(splitRe);

    var dirs = [];
    for (var i = parts.length - 1; i >= 0; i--) {
        if (parts[i] === modules) continue;
        var dir = path.join(
            path.join.apply(path, parts.slice(0, i + 1)),
            modules
        );
        dirs.push(prefix + dir);
    }
    return dirs.concat(opts.paths);
}
}).call(this,_dereq_("JkpR2F"))
},{"JkpR2F":17,"path":16}],22:[function(_dereq_,module,exports){
var core = _dereq_('./core');
var fs = _dereq_('fs');
var path = _dereq_('path');
var caller = _dereq_('./caller.js');
var nodeModulesPaths = _dereq_('./node-modules-paths.js');

module.exports = function (x, opts) {
    if (!opts) opts = {};
    var isFile = opts.isFile || function (file) {
        try { var stat = fs.statSync(file) }
        catch (err) { if (err && err.code === 'ENOENT') return false }
        return stat.isFile() || stat.isFIFO();
    };
    var readFileSync = opts.readFileSync || fs.readFileSync;
    
    var extensions = opts.extensions || [ '.js' ];
    var y = opts.basedir || path.dirname(caller());

    opts.paths = opts.paths || [];

    if (x.match(/^(?:\.\.?\/|\/|([A-Za-z]:)?\\)/)) {
        var m = loadAsFileSync(path.resolve(y, x))
            || loadAsDirectorySync(path.resolve(y, x));
        if (m) return m;
    } else {
        var n = loadNodeModulesSync(x, y);
        if (n) return n;
    }
    
    if (core[x]) return x;
    
    throw new Error("Cannot find module '" + x + "' from '" + y + "'");
    
    function loadAsFileSync (x) {
        if (isFile(x)) {
            return x;
        }
        
        for (var i = 0; i < extensions.length; i++) {
            var file = x + extensions[i];
            if (isFile(file)) {
                return file;
            }
        }
    }
    
    function loadAsDirectorySync (x) {
        var pkgfile = path.join(x, '/package.json');
        if (isFile(pkgfile)) {
            var body = readFileSync(pkgfile, 'utf8');
            try {
                var pkg = JSON.parse(body);
                if (opts.packageFilter) {
                    pkg = opts.packageFilter(pkg, x);
                }
                
                if (pkg.main) {
                    var m = loadAsFileSync(path.resolve(x, pkg.main));
                    if (m) return m;
                    var n = loadAsDirectorySync(path.resolve(x, pkg.main));
                    if (n) return n;
                }
            }
            catch (err) {}
        }
        
        return loadAsFileSync(path.join( x, '/index'));
    }
    
    function loadNodeModulesSync (x, start) {
        var dirs = nodeModulesPaths(start, opts);
        for (var i = 0; i < dirs.length; i++) {
            var dir = dirs[i];
            var m = loadAsFileSync(path.join( dir, '/', x));
            if (m) return m;
            var n = loadAsDirectorySync(path.join( dir, '/', x ));
            if (n) return n;
        }
    }
};

},{"./caller.js":18,"./core":19,"./node-modules-paths.js":21,"fs":15,"path":16}],23:[function(_dereq_,module,exports){
/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = _dereq_('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = _dereq_('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = _dereq_('./source-map/source-node').SourceNode;

},{"./source-map/source-map-consumer":28,"./source-map/source-map-generator":29,"./source-map/source-node":30}],24:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  var util = _dereq_('./util');

  /**
   * A data structure which is a combination of an array and a set. Adding a new
   * member is O(1), testing for membership is O(1), and finding the index of an
   * element is O(1). Removing elements from the set is not supported. Only
   * strings are supported for membership.
   */
  function ArraySet() {
    this._array = [];
    this._set = {};
  }

  /**
   * Static method for creating ArraySet instances from an existing array.
   */
  ArraySet.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
    var set = new ArraySet();
    for (var i = 0, len = aArray.length; i < len; i++) {
      set.add(aArray[i], aAllowDuplicates);
    }
    return set;
  };

  /**
   * Add the given string to this set.
   *
   * @param String aStr
   */
  ArraySet.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
    var isDuplicate = this.has(aStr);
    var idx = this._array.length;
    if (!isDuplicate || aAllowDuplicates) {
      this._array.push(aStr);
    }
    if (!isDuplicate) {
      this._set[util.toSetString(aStr)] = idx;
    }
  };

  /**
   * Is the given string a member of this set?
   *
   * @param String aStr
   */
  ArraySet.prototype.has = function ArraySet_has(aStr) {
    return Object.prototype.hasOwnProperty.call(this._set,
                                                util.toSetString(aStr));
  };

  /**
   * What is the index of the given string in the array?
   *
   * @param String aStr
   */
  ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
    if (this.has(aStr)) {
      return this._set[util.toSetString(aStr)];
    }
    throw new Error('"' + aStr + '" is not in the set.');
  };

  /**
   * What is the element at the given index?
   *
   * @param Number aIdx
   */
  ArraySet.prototype.at = function ArraySet_at(aIdx) {
    if (aIdx >= 0 && aIdx < this._array.length) {
      return this._array[aIdx];
    }
    throw new Error('No element indexed by ' + aIdx);
  };

  /**
   * Returns the array representation of this set (which has the proper indices
   * indicated by indexOf). Note that this is a copy of the internal array used
   * for storing the members so that no one can mess with internal state.
   */
  ArraySet.prototype.toArray = function ArraySet_toArray() {
    return this._array.slice();
  };

  exports.ArraySet = ArraySet;

});

},{"./util":31,"amdefine":32}],25:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  var base64 = _dereq_('./base64');

  // A single base 64 digit can contain 6 bits of data. For the base 64 variable
  // length quantities we use in the source map spec, the first bit is the sign,
  // the next four bits are the actual value, and the 6th bit is the
  // continuation bit. The continuation bit tells us whether there are more
  // digits in this value following this digit.
  //
  //   Continuation
  //   |    Sign
  //   |    |
  //   V    V
  //   101011

  var VLQ_BASE_SHIFT = 5;

  // binary: 100000
  var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

  // binary: 011111
  var VLQ_BASE_MASK = VLQ_BASE - 1;

  // binary: 100000
  var VLQ_CONTINUATION_BIT = VLQ_BASE;

  /**
   * Converts from a two-complement value to a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
   *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
   */
  function toVLQSigned(aValue) {
    return aValue < 0
      ? ((-aValue) << 1) + 1
      : (aValue << 1) + 0;
  }

  /**
   * Converts to a two-complement value from a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
   *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
   */
  function fromVLQSigned(aValue) {
    var isNegative = (aValue & 1) === 1;
    var shifted = aValue >> 1;
    return isNegative
      ? -shifted
      : shifted;
  }

  /**
   * Returns the base 64 VLQ encoded value.
   */
  exports.encode = function base64VLQ_encode(aValue) {
    var encoded = "";
    var digit;

    var vlq = toVLQSigned(aValue);

    do {
      digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        // There are still more digits in this value, so we must make sure the
        // continuation bit is marked.
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += base64.encode(digit);
    } while (vlq > 0);

    return encoded;
  };

  /**
   * Decodes the next base 64 VLQ value from the given string and returns the
   * value and the rest of the string.
   */
  exports.decode = function base64VLQ_decode(aStr) {
    var i = 0;
    var strLen = aStr.length;
    var result = 0;
    var shift = 0;
    var continuation, digit;

    do {
      if (i >= strLen) {
        throw new Error("Expected more digits in base 64 VLQ value.");
      }
      digit = base64.decode(aStr.charAt(i++));
      continuation = !!(digit & VLQ_CONTINUATION_BIT);
      digit &= VLQ_BASE_MASK;
      result = result + (digit << shift);
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    return {
      value: fromVLQSigned(result),
      rest: aStr.slice(i)
    };
  };

});

},{"./base64":26,"amdefine":32}],26:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  var charToIntMap = {};
  var intToCharMap = {};

  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .forEach(function (ch, index) {
      charToIntMap[ch] = index;
      intToCharMap[index] = ch;
    });

  /**
   * Encode an integer in the range of 0 to 63 to a single base 64 digit.
   */
  exports.encode = function base64_encode(aNumber) {
    if (aNumber in intToCharMap) {
      return intToCharMap[aNumber];
    }
    throw new TypeError("Must be between 0 and 63: " + aNumber);
  };

  /**
   * Decode a single base 64 digit to an integer.
   */
  exports.decode = function base64_decode(aChar) {
    if (aChar in charToIntMap) {
      return charToIntMap[aChar];
    }
    throw new TypeError("Not a valid base 64 digit: " + aChar);
  };

});

},{"amdefine":32}],27:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the next
    //      closest element that is less than that element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element which is less than the one we are searching for, so we
    //      return null.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid], true);
    if (cmp === 0) {
      // Found the element we are looking for.
      return aHaystack[mid];
    }
    else if (cmp > 0) {
      // aHaystack[mid] is greater than our needle.
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare);
      }
      // We did not find an exact match, return the next closest one
      // (termination case 2).
      return aHaystack[mid];
    }
    else {
      // aHaystack[mid] is less than our needle.
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare);
      }
      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (2) or (3) and return the appropriate thing.
      return aLow < 0
        ? null
        : aHaystack[aLow];
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the next lowest value checked if there is no exact hit. This is because
   * mappings between original and generated line/col pairs are single points,
   * and there is an implicit region between each of them, so a miss just means
   * that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare) {
    return aHaystack.length > 0
      ? recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack, aCompare)
      : null;
  };

});

},{"amdefine":32}],28:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  var util = _dereq_('./util');
  var binarySearch = _dereq_('./binary-search');
  var ArraySet = _dereq_('./array-set').ArraySet;
  var base64VLQ = _dereq_('./base64-vlq');

  /**
   * A SourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The only parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
    // requires the array) to play nice here.
    var names = util.getArg(sourceMap, 'names', []);
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file', null);

    // Once again, Sass deviates from the spec and supplies the version as a
    // string rather than a number, so we use loose equality checking here.
    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    // Pass `true` below to allow duplicate names and sources. While source maps
    // are intended to be compressed and deduplicated, the TypeScript compiler
    // sometimes generates source maps with duplicates in them. See Github issue
    // #72 and bugzil.la/889492.
    this._names = ArraySet.fromArray(names, true);
    this._sources = ArraySet.fromArray(sources, true);

    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this._mappings = mappings;
    this.file = file;
  }

  /**
   * Create a SourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @returns SourceMapConsumer
   */
  SourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap) {
      var smc = Object.create(SourceMapConsumer.prototype);

      smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
      smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
      smc.sourceRoot = aSourceMap._sourceRoot;
      smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                              smc.sourceRoot);
      smc.file = aSourceMap._file;

      smc.__generatedMappings = aSourceMap._mappings.slice()
        .sort(util.compareByGeneratedPositions);
      smc.__originalMappings = aSourceMap._mappings.slice()
        .sort(util.compareByOriginalPositions);

      return smc;
    };

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(SourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  // `__generatedMappings` and `__originalMappings` are arrays that hold the
  // parsed mapping coordinates from the source map's "mappings" attribute. They
  // are lazily instantiated, accessed via the `_generatedMappings` and
  // `_originalMappings` getters respectively, and we only parse the mappings
  // and create these arrays once queried for a source location. We jump through
  // these hoops because there can be many thousands of mappings, and parsing
  // them is expensive, so we only want to do it if we must.
  //
  // Each object in the arrays is of the form:
  //
  //     {
  //       generatedLine: The line number in the generated code,
  //       generatedColumn: The column number in the generated code,
  //       source: The path to the original source file that generated this
  //               chunk of code,
  //       originalLine: The line number in the original source that
  //                     corresponds to this chunk of generated code,
  //       originalColumn: The column number in the original source that
  //                       corresponds to this chunk of generated code,
  //       name: The name of the original symbol which generated this chunk of
  //             code.
  //     }
  //
  // All properties except for `generatedLine` and `generatedColumn` can be
  // `null`.
  //
  // `_generatedMappings` is ordered by the generated positions.
  //
  // `_originalMappings` is ordered by the original positions.

  SourceMapConsumer.prototype.__generatedMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
    get: function () {
      if (!this.__generatedMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__generatedMappings;
    }
  });

  SourceMapConsumer.prototype.__originalMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
    get: function () {
      if (!this.__originalMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__originalMappings;
    }
  });

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var mappingSeparator = /^[,;]/;
      var str = aStr;
      var mapping;
      var temp;

      while (str.length > 0) {
        if (str.charAt(0) === ';') {
          generatedLine++;
          str = str.slice(1);
          previousGeneratedColumn = 0;
        }
        else if (str.charAt(0) === ',') {
          str = str.slice(1);
        }
        else {
          mapping = {};
          mapping.generatedLine = generatedLine;

          // Generated column.
          temp = base64VLQ.decode(str);
          mapping.generatedColumn = previousGeneratedColumn + temp.value;
          previousGeneratedColumn = mapping.generatedColumn;
          str = temp.rest;

          if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
            // Original source.
            temp = base64VLQ.decode(str);
            mapping.source = this._sources.at(previousSource + temp.value);
            previousSource += temp.value;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source, but no line and column');
            }

            // Original line.
            temp = base64VLQ.decode(str);
            mapping.originalLine = previousOriginalLine + temp.value;
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source and line, but no column');
            }

            // Original column.
            temp = base64VLQ.decode(str);
            mapping.originalColumn = previousOriginalColumn + temp.value;
            previousOriginalColumn = mapping.originalColumn;
            str = temp.rest;

            if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
              // Original name.
              temp = base64VLQ.decode(str);
              mapping.name = this._names.at(previousName + temp.value);
              previousName += temp.value;
              str = temp.rest;
            }
          }

          this.__generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            this.__originalMappings.push(mapping);
          }
        }
      }

      this.__originalMappings.sort(util.compareByOriginalPositions);
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  SourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator);
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  SourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var mapping = this._findMapping(needle,
                                      this._generatedMappings,
                                      "generatedLine",
                                      "generatedColumn",
                                      util.compareByGeneratedPositions);

      if (mapping) {
        var source = util.getArg(mapping, 'source', null);
        if (source && this.sourceRoot) {
          source = util.join(this.sourceRoot, source);
        }
        return {
          source: source,
          line: util.getArg(mapping, 'originalLine', null),
          column: util.getArg(mapping, 'originalColumn', null),
          name: util.getArg(mapping, 'name', null)
        };
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * availible.
   */
  SourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource) {
      if (!this.sourcesContent) {
        return null;
      }

      if (this.sourceRoot) {
        aSource = util.relative(this.sourceRoot, aSource);
      }

      if (this._sources.has(aSource)) {
        return this.sourcesContent[this._sources.indexOf(aSource)];
      }

      var url;
      if (this.sourceRoot
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + aSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + aSource)];
        }
      }

      throw new Error('"' + aSource + '" is not in the SourceMap.');
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      if (this.sourceRoot) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var mapping = this._findMapping(needle,
                                      this._originalMappings,
                                      "originalLine",
                                      "originalColumn",
                                      util.compareByOriginalPositions);

      if (mapping) {
        return {
          line: util.getArg(mapping, 'generatedLine', null),
          column: util.getArg(mapping, 'generatedColumn', null)
        };
      }

      return {
        line: null,
        column: null
      };
    };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source;
        if (source && sourceRoot) {
          source = util.join(sourceRoot, source);
        }
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name
        };
      }).forEach(aCallback, context);
    };

  exports.SourceMapConsumer = SourceMapConsumer;

});

},{"./array-set":24,"./base64-vlq":25,"./binary-search":27,"./util":31,"amdefine":32}],29:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  var base64VLQ = _dereq_('./base64-vlq');
  var util = _dereq_('./util');
  var ArraySet = _dereq_('./array-set').ArraySet;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. To create a new one, you must pass an object
   * with the following properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: An optional root for all URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    this._file = util.getArg(aArgs, 'file');
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._sources = new ArraySet();
    this._names = new ArraySet();
    this._mappings = [];
    this._sourcesContents = null;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source) {
          newMapping.source = mapping.source;
          if (sourceRoot) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      this._validateMapping(generated, original, source, name);

      if (source && !this._sources.has(source)) {
        this._sources.add(source);
      }

      if (name && !this._names.has(name)) {
        this._names.add(name);
      }

      this._mappings.push({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        originalLine: original != null && original.line,
        originalColumn: original != null && original.column,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent !== null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = {};
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile) {
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (!aSourceFile) {
        aSourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "aSourceFile" relative if an absolute Url is passed.
      if (sourceRoot) {
        aSourceFile = util.relative(sourceRoot, aSourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "aSourceFile"
      this._mappings.forEach(function (mapping) {
        if (mapping.source === aSourceFile && mapping.originalLine) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
          });
          if (original.source !== null) {
            // Copy mapping
            if (sourceRoot) {
              mapping.source = util.relative(sourceRoot, original.source);
            } else {
              mapping.source = original.source;
            }
            mapping.originalLine = original.line;
            mapping.originalColumn = original.column;
            if (original.name !== null && mapping.name !== null) {
              // Only use the identifier name if it's an identifier
              // in both SourceMaps
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this._names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          if (sourceRoot) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping: ' + JSON.stringify({
          generated: aGenerated,
          source: aSource,
          orginal: aOriginal,
          name: aName
        }));
      }
    };

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var mapping;

      // The mappings must be guaranteed to be in sorted order before we start
      // serializing them or else the generated line numbers (which are defined
      // via the ';' separators) will be all messed up. Note: it might be more
      // performant to maintain the sorting as we insert them, rather than as we
      // serialize them, but the big O is the same either way.
      this._mappings.sort(util.compareByGeneratedPositions);

      for (var i = 0, len = this._mappings.length; i < len; i++) {
        mapping = this._mappings[i];

        if (mapping.generatedLine !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generatedLine !== previousGeneratedLine) {
            result += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!util.compareByGeneratedPositions(mapping, this._mappings[i - 1])) {
              continue;
            }
            result += ',';
          }
        }

        result += base64VLQ.encode(mapping.generatedColumn
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generatedColumn;

        if (mapping.source) {
          result += base64VLQ.encode(this._sources.indexOf(mapping.source)
                                     - previousSource);
          previousSource = this._sources.indexOf(mapping.source);

          // lines are stored 0-based in SourceMap spec version 3
          result += base64VLQ.encode(mapping.originalLine - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          result += base64VLQ.encode(mapping.originalColumn
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.name) {
            result += base64VLQ.encode(this._names.indexOf(mapping.name)
                                       - previousName);
            previousName = this._names.indexOf(mapping.name);
          }
        }
      }

      return result;
    };

  SourceMapGenerator.prototype._generateSourcesContent =
    function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
      return aSources.map(function (source) {
        if (!this._sourcesContents) {
          return null;
        }
        if (aSourceRoot) {
          source = util.relative(aSourceRoot, source);
        }
        var key = util.toSetString(source);
        return Object.prototype.hasOwnProperty.call(this._sourcesContents,
                                                    key)
          ? this._sourcesContents[key]
          : null;
      }, this);
    };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        file: this._file,
        sources: this._sources.toArray(),
        names: this._names.toArray(),
        mappings: this._serializeMappings()
      };
      if (this._sourceRoot) {
        map.sourceRoot = this._sourceRoot;
      }
      if (this._sourcesContents) {
        map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
      }

      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this);
    };

  exports.SourceMapGenerator = SourceMapGenerator;

});

},{"./array-set":24,"./base64-vlq":25,"./util":31,"amdefine":32}],30:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  var SourceMapGenerator = _dereq_('./source-map-generator').SourceMapGenerator;
  var util = _dereq_('./util');

  /**
   * SourceNodes provide a way to abstract over interpolating/concatenating
   * snippets of generated JavaScript source code while maintaining the line and
   * column information associated with the original source code.
   *
   * @param aLine The original line number.
   * @param aColumn The original column number.
   * @param aSource The original source's filename.
   * @param aChunks Optional. An array of strings which are snippets of
   *        generated JS, or other SourceNodes.
   * @param aName The original identifier.
   */
  function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
    this.children = [];
    this.sourceContents = {};
    this.line = aLine === undefined ? null : aLine;
    this.column = aColumn === undefined ? null : aColumn;
    this.source = aSource === undefined ? null : aSource;
    this.name = aName === undefined ? null : aName;
    if (aChunks != null) this.add(aChunks);
  }

  /**
   * Creates a SourceNode from generated code and a SourceMapConsumer.
   *
   * @param aGeneratedCode The generated code
   * @param aSourceMapConsumer The SourceMap for the generated code
   */
  SourceNode.fromStringWithSourceMap =
    function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer) {
      // The SourceNode we want to fill with the generated code
      // and the SourceMap
      var node = new SourceNode();

      // The generated code
      // Processed fragments are removed from this array.
      var remainingLines = aGeneratedCode.split('\n');

      // We need to remember the position of "remainingLines"
      var lastGeneratedLine = 1, lastGeneratedColumn = 0;

      // The generate SourceNodes we need a code range.
      // To extract it current and last mapping is used.
      // Here we store the last mapping.
      var lastMapping = null;

      aSourceMapConsumer.eachMapping(function (mapping) {
        if (lastMapping === null) {
          // We add the generated code until the first mapping
          // to the SourceNode without any mapping.
          // Each line is added as separate string.
          while (lastGeneratedLine < mapping.generatedLine) {
            node.add(remainingLines.shift() + "\n");
            lastGeneratedLine++;
          }
          if (lastGeneratedColumn < mapping.generatedColumn) {
            var nextLine = remainingLines[0];
            node.add(nextLine.substr(0, mapping.generatedColumn));
            remainingLines[0] = nextLine.substr(mapping.generatedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
          }
        } else {
          // We add the code from "lastMapping" to "mapping":
          // First check if there is a new line in between.
          if (lastGeneratedLine < mapping.generatedLine) {
            var code = "";
            // Associate full lines with "lastMapping"
            do {
              code += remainingLines.shift() + "\n";
              lastGeneratedLine++;
              lastGeneratedColumn = 0;
            } while (lastGeneratedLine < mapping.generatedLine);
            // When we reached the correct line, we add code until we
            // reach the correct column too.
            if (lastGeneratedColumn < mapping.generatedColumn) {
              var nextLine = remainingLines[0];
              code += nextLine.substr(0, mapping.generatedColumn);
              remainingLines[0] = nextLine.substr(mapping.generatedColumn);
              lastGeneratedColumn = mapping.generatedColumn;
            }
            // Create the SourceNode.
            addMappingWithCode(lastMapping, code);
          } else {
            // There is no new line in between.
            // Associate the code between "lastGeneratedColumn" and
            // "mapping.generatedColumn" with "lastMapping"
            var nextLine = remainingLines[0];
            var code = nextLine.substr(0, mapping.generatedColumn -
                                          lastGeneratedColumn);
            remainingLines[0] = nextLine.substr(mapping.generatedColumn -
                                                lastGeneratedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
            addMappingWithCode(lastMapping, code);
          }
        }
        lastMapping = mapping;
      }, this);
      // We have processed all mappings.
      // Associate the remaining code in the current line with "lastMapping"
      // and add the remaining lines without any mapping
      addMappingWithCode(lastMapping, remainingLines.join("\n"));

      // Copy sourcesContent into SourceNode
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          node.setSourceContent(sourceFile, content);
        }
      });

      return node;

      function addMappingWithCode(mapping, code) {
        if (mapping === null || mapping.source === undefined) {
          node.add(code);
        } else {
          node.add(new SourceNode(mapping.originalLine,
                                  mapping.originalColumn,
                                  mapping.source,
                                  code,
                                  mapping.name));
        }
      }
    };

  /**
   * Add a chunk of generated JS to this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.add = function SourceNode_add(aChunk) {
    if (Array.isArray(aChunk)) {
      aChunk.forEach(function (chunk) {
        this.add(chunk);
      }, this);
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      if (aChunk) {
        this.children.push(aChunk);
      }
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Add a chunk of generated JS to the beginning of this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
    if (Array.isArray(aChunk)) {
      for (var i = aChunk.length-1; i >= 0; i--) {
        this.prepend(aChunk[i]);
      }
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      this.children.unshift(aChunk);
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Walk over the tree of JS snippets in this node and its children. The
   * walking function is called once for each snippet of JS and is passed that
   * snippet and the its original associated source's line/column location.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walk = function SourceNode_walk(aFn) {
    var chunk;
    for (var i = 0, len = this.children.length; i < len; i++) {
      chunk = this.children[i];
      if (chunk instanceof SourceNode) {
        chunk.walk(aFn);
      }
      else {
        if (chunk !== '') {
          aFn(chunk, { source: this.source,
                       line: this.line,
                       column: this.column,
                       name: this.name });
        }
      }
    }
  };

  /**
   * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
   * each of `this.children`.
   *
   * @param aSep The separator.
   */
  SourceNode.prototype.join = function SourceNode_join(aSep) {
    var newChildren;
    var i;
    var len = this.children.length;
    if (len > 0) {
      newChildren = [];
      for (i = 0; i < len-1; i++) {
        newChildren.push(this.children[i]);
        newChildren.push(aSep);
      }
      newChildren.push(this.children[i]);
      this.children = newChildren;
    }
    return this;
  };

  /**
   * Call String.prototype.replace on the very right-most source snippet. Useful
   * for trimming whitespace from the end of a source node, etc.
   *
   * @param aPattern The pattern to replace.
   * @param aReplacement The thing to replace the pattern with.
   */
  SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
    var lastChild = this.children[this.children.length - 1];
    if (lastChild instanceof SourceNode) {
      lastChild.replaceRight(aPattern, aReplacement);
    }
    else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
    }
    else {
      this.children.push(''.replace(aPattern, aReplacement));
    }
    return this;
  };

  /**
   * Set the source content for a source file. This will be added to the SourceMapGenerator
   * in the sourcesContent field.
   *
   * @param aSourceFile The filename of the source file
   * @param aSourceContent The content of the source file
   */
  SourceNode.prototype.setSourceContent =
    function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
      this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
    };

  /**
   * Walk over the tree of SourceNodes. The walking function is called for each
   * source file content and is passed the filename and source content.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walkSourceContents =
    function SourceNode_walkSourceContents(aFn) {
      for (var i = 0, len = this.children.length; i < len; i++) {
        if (this.children[i] instanceof SourceNode) {
          this.children[i].walkSourceContents(aFn);
        }
      }

      var sources = Object.keys(this.sourceContents);
      for (var i = 0, len = sources.length; i < len; i++) {
        aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
      }
    };

  /**
   * Return the string representation of this source node. Walks over the tree
   * and concatenates all the various snippets together to one string.
   */
  SourceNode.prototype.toString = function SourceNode_toString() {
    var str = "";
    this.walk(function (chunk) {
      str += chunk;
    });
    return str;
  };

  /**
   * Returns the string representation of this source node along with a source
   * map.
   */
  SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: "",
      line: 1,
      column: 0
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    var lastOriginalSource = null;
    var lastOriginalLine = null;
    var lastOriginalColumn = null;
    var lastOriginalName = null;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (original.source !== null
          && original.line !== null
          && original.column !== null) {
        if(lastOriginalSource !== original.source
           || lastOriginalLine !== original.line
           || lastOriginalColumn !== original.column
           || lastOriginalName !== original.name) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column
            },
            generated: {
              line: generated.line,
              column: generated.column
            },
            name: original.name
          });
        }
        lastOriginalSource = original.source;
        lastOriginalLine = original.line;
        lastOriginalColumn = original.column;
        lastOriginalName = original.name;
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column
          }
        });
        lastOriginalSource = null;
        sourceMappingActive = false;
      }
      chunk.split('').forEach(function (ch) {
        if (ch === '\n') {
          generated.line++;
          generated.column = 0;
        } else {
          generated.column++;
        }
      });
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

  exports.SourceNode = SourceNode;

});

},{"./source-map-generator":29,"./util":31,"amdefine":32}],31:[function(_dereq_,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = _dereq_('amdefine')(module, _dereq_);
}
define(function (_dereq_, exports, module) {

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp = /([\w+\-.]+):\/\/((\w+:\w+)@)?([\w.]+)?(:(\d+))?(\S+)?/;
  var dataUrlRegexp = /^data:.+\,.+/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[3],
      host: match[4],
      port: match[6],
      path: match[7]
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = aParsedUrl.scheme + "://";
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + "@"
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  function join(aRoot, aPath) {
    var url;

    if (aPath.match(urlRegexp) || aPath.match(dataUrlRegexp)) {
      return aPath;
    }

    if (aPath.charAt(0) === '/' && (url = urlParse(aRoot))) {
      url.path = aPath;
      return urlGenerate(url);
    }

    return aRoot.replace(/\/$/, '') + '/' + aPath;
  }
  exports.join = join;

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    return '$' + aStr;
  }
  exports.toSetString = toSetString;

  function fromSetString(aStr) {
    return aStr.substr(1);
  }
  exports.fromSetString = fromSetString;

  function relative(aRoot, aPath) {
    aRoot = aRoot.replace(/\/$/, '');

    var url = urlParse(aRoot);
    if (aPath.charAt(0) == "/" && url && url.path == "/") {
      return aPath.slice(1);
    }

    return aPath.indexOf(aRoot + '/') === 0
      ? aPath.substr(aRoot.length + 1)
      : aPath;
  }
  exports.relative = relative;

  function strcmp(aStr1, aStr2) {
    var s1 = aStr1 || "";
    var s2 = aStr2 || "";
    return (s1 > s2) - (s1 < s2);
  }

  /**
   * Comparator between two mappings where the original positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same original source/line/column, but different generated
   * line and column the same. Useful when searching for a mapping with a
   * stubbed out mapping.
   */
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp;

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp || onlyCompareOriginal) {
      return cmp;
    }

    cmp = strcmp(mappingA.name, mappingB.name);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    return mappingA.generatedColumn - mappingB.generatedColumn;
  };
  exports.compareByOriginalPositions = compareByOriginalPositions;

  /**
   * Comparator between two mappings where the generated positions are
   * compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same generated line and column, but different
   * source/name/original line and column the same. Useful when searching for a
   * mapping with a stubbed out mapping.
   */
  function compareByGeneratedPositions(mappingA, mappingB, onlyCompareGenerated) {
    var cmp;

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp || onlyCompareGenerated) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  };
  exports.compareByGeneratedPositions = compareByGeneratedPositions;

});

},{"amdefine":32}],32:[function(_dereq_,module,exports){
(function (process,__filename){
/** vim: et:ts=4:sw=4:sts=4
 * @license amdefine 0.1.0 Copyright (c) 2011, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/amdefine for details
 */

/*jslint node: true */
/*global module, process */
'use strict';

/**
 * Creates a define for node.
 * @param {Object} module the "module" object that is defined by Node for the
 * current module.
 * @param {Function} [requireFn]. Node's require function for the current module.
 * It only needs to be passed in Node versions before 0.5, when module.require
 * did not exist.
 * @returns {Function} a define function that is usable for the current node
 * module.
 */
function amdefine(module, requireFn) {
    'use strict';
    var defineCache = {},
        loaderCache = {},
        alreadyCalled = false,
        path = _dereq_('path'),
        makeRequire, stringRequire;

    /**
     * Trims the . and .. from an array of path segments.
     * It will keep a leading path segment if a .. will become
     * the first path segment, to help with module name lookups,
     * which act like paths, but can be remapped. But the end result,
     * all paths that use this function should look normalized.
     * NOTE: this method MODIFIES the input array.
     * @param {Array} ary the array of path segments.
     */
    function trimDots(ary) {
        var i, part;
        for (i = 0; ary[i]; i+= 1) {
            part = ary[i];
            if (part === '.') {
                ary.splice(i, 1);
                i -= 1;
            } else if (part === '..') {
                if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                    //End of the line. Keep at least one non-dot
                    //path segment at the front so it can be mapped
                    //correctly to disk. Otherwise, there is likely
                    //no path mapping for a path starting with '..'.
                    //This can still fail, but catches the most reasonable
                    //uses of ..
                    break;
                } else if (i > 0) {
                    ary.splice(i - 1, 2);
                    i -= 2;
                }
            }
        }
    }

    function normalize(name, baseName) {
        var baseParts;

        //Adjust any relative paths.
        if (name && name.charAt(0) === '.') {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                baseParts = baseName.split('/');
                baseParts = baseParts.slice(0, baseParts.length - 1);
                baseParts = baseParts.concat(name.split('/'));
                trimDots(baseParts);
                name = baseParts.join('/');
            }
        }

        return name;
    }

    /**
     * Create the normalize() function passed to a loader plugin's
     * normalize method.
     */
    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(id) {
        function load(value) {
            loaderCache[id] = value;
        }

        load.fromText = function (id, text) {
            //This one is difficult because the text can/probably uses
            //define, and any relative paths and requires should be relative
            //to that id was it would be found on disk. But this would require
            //bootstrapping a module/require fairly deeply from node core.
            //Not sure how best to go about that yet.
            throw new Error('amdefine does not implement load.fromText');
        };

        return load;
    }

    makeRequire = function (systemRequire, exports, module, relId) {
        function amdRequire(deps, callback) {
            if (typeof deps === 'string') {
                //Synchronous, single module require('')
                return stringRequire(systemRequire, exports, module, deps, relId);
            } else {
                //Array of dependencies with a callback.

                //Convert the dependencies to modules.
                deps = deps.map(function (depName) {
                    return stringRequire(systemRequire, exports, module, depName, relId);
                });

                //Wait for next tick to call back the require call.
                process.nextTick(function () {
                    callback.apply(null, deps);
                });
            }
        }

        amdRequire.toUrl = function (filePath) {
            if (filePath.indexOf('.') === 0) {
                return normalize(filePath, path.dirname(module.filename));
            } else {
                return filePath;
            }
        };

        return amdRequire;
    };

    //Favor explicit value, passed in if the module wants to support Node 0.4.
    requireFn = requireFn || function req() {
        return module.require.apply(module, arguments);
    };

    function runFactory(id, deps, factory) {
        var r, e, m, result;

        if (id) {
            e = loaderCache[id] = {};
            m = {
                id: id,
                uri: __filename,
                exports: e
            };
            r = makeRequire(requireFn, e, m, id);
        } else {
            //Only support one define call per file
            if (alreadyCalled) {
                throw new Error('amdefine with no module ID cannot be called more than once per file.');
            }
            alreadyCalled = true;

            //Use the real variables from node
            //Use module.exports for exports, since
            //the exports in here is amdefine exports.
            e = module.exports;
            m = module;
            r = makeRequire(requireFn, e, m, module.id);
        }

        //If there are dependencies, they are strings, so need
        //to convert them to dependency values.
        if (deps) {
            deps = deps.map(function (depName) {
                return r(depName);
            });
        }

        //Call the factory with the right dependencies.
        if (typeof factory === 'function') {
            result = factory.apply(m.exports, deps);
        } else {
            result = factory;
        }

        if (result !== undefined) {
            m.exports = result;
            if (id) {
                loaderCache[id] = m.exports;
            }
        }
    }

    stringRequire = function (systemRequire, exports, module, id, relId) {
        //Split the ID by a ! so that
        var index = id.indexOf('!'),
            originalId = id,
            prefix, plugin;

        if (index === -1) {
            id = normalize(id, relId);

            //Straight module lookup. If it is one of the special dependencies,
            //deal with it, otherwise, delegate to node.
            if (id === 'require') {
                return makeRequire(systemRequire, exports, module, relId);
            } else if (id === 'exports') {
                return exports;
            } else if (id === 'module') {
                return module;
            } else if (loaderCache.hasOwnProperty(id)) {
                return loaderCache[id];
            } else if (defineCache[id]) {
                runFactory.apply(null, defineCache[id]);
                return loaderCache[id];
            } else {
                if(systemRequire) {
                    return systemRequire(originalId);
                } else {
                    throw new Error('No module with ID: ' + id);
                }
            }
        } else {
            //There is a plugin in play.
            prefix = id.substring(0, index);
            id = id.substring(index + 1, id.length);

            plugin = stringRequire(systemRequire, exports, module, prefix, relId);

            if (plugin.normalize) {
                id = plugin.normalize(id, makeNormalize(relId));
            } else {
                //Normalize the ID normally.
                id = normalize(id, relId);
            }

            if (loaderCache[id]) {
                return loaderCache[id];
            } else {
                plugin.load(id, makeRequire(systemRequire, exports, module, relId), makeLoad(id), {});

                return loaderCache[id];
            }
        }
    };

    //Create a define function specific to the module asking for amdefine.
    function define(id, deps, factory) {
        if (Array.isArray(id)) {
            factory = deps;
            deps = id;
            id = undefined;
        } else if (typeof id !== 'string') {
            factory = id;
            id = deps = undefined;
        }

        if (deps && !Array.isArray(deps)) {
            factory = deps;
            deps = undefined;
        }

        if (!deps) {
            deps = ['require', 'exports', 'module'];
        }

        //Set up properties for this module. If an ID, then use
        //internal cache. If no ID, then use the external variables
        //for this node module.
        if (id) {
            //Put the module in deep freeze until there is a
            //require call for it.
            defineCache[id] = [id, deps, factory];
        } else {
            runFactory(id, deps, factory);
        }
    }

    //define.require, which has access to all the values in the
    //cache. Useful for AMD modules that all have IDs in the file,
    //but need to finally export a value to node based on one of those
    //IDs.
    define.require = function (id) {
        if (loaderCache[id]) {
            return loaderCache[id];
        }

        if (defineCache[id]) {
            runFactory.apply(null, defineCache[id]);
            return loaderCache[id];
        }
    };

    define.amd = {};

    return define;
}

module.exports = amdefine;

}).call(this,_dereq_("JkpR2F"),"/../node_modules/source-map/node_modules/amdefine/amdefine.js")
},{"JkpR2F":17,"path":16}],33:[function(_dereq_,module,exports){
//     Underscore.js 1.3.3
//     (c) 2009-2012 Jeremy Ashkenas, DocumentCloud Inc.
//     Underscore is freely distributable under the MIT license.
//     Portions of Underscore are inspired or borrowed from Prototype,
//     Oliver Steele's Functional, and John Resig's Micro-Templating.
//     For all details and documentation:
//     http://documentcloud.github.com/underscore

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `global` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var slice            = ArrayProto.slice,
      unshift          = ArrayProto.unshift,
      toString         = ObjProto.toString,
      hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) { return new wrapper(obj); };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root['_'] = _;
  }

  // Current version.
  _.VERSION = '1.3.3';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, l = obj.length; i < l; i++) {
        if (i in obj && iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      for (var key in obj) {
        if (_.has(obj, key)) {
          if (iterator.call(context, obj[key], key, obj) === breaker) return;
        }
      }
    }
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results[results.length] = iterator.call(context, value, index, list);
    });
    if (obj.length === +obj.length) results.length = obj.length;
    return results;
  };

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError('Reduce of empty array with no initial value');
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var reversed = _.toArray(obj).reverse();
    if (context && !initial) iterator = _.bind(iterator, context);
    return initial ? _.reduce(reversed, iterator, memo, context) : _.reduce(reversed, iterator);
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, iterator, context) {
    var result;
    any(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(iterator, context);
    each(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) results[results.length] = value;
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    each(obj, function(value, index, list) {
      if (!iterator.call(context, value, index, list)) results[results.length] = value;
    });
    return results;
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, iterator, context) {
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(iterator, context);
    each(obj, function(value, index, list) {
      if (!(result = result && iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(iterator, context);
    each(obj, function(value, index, list) {
      if (result || (result = iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if a given value is included in the array or object using `===`.
  // Aliased as `contains`.
  _.include = _.contains = function(obj, target) {
    var found = false;
    if (obj == null) return found;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    found = any(obj, function(value) {
      return value === target;
    });
    return found;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    return _.map(obj, function(value) {
      return (_.isFunction(method) ? method || value : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, function(value){ return value[key]; });
  };

  // Return the maximum element or (element-based computation).
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0]) return Math.max.apply(Math, obj);
    if (!iterator && _.isEmpty(obj)) return -Infinity;
    var result = {computed : -Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed >= result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0]) return Math.min.apply(Math, obj);
    if (!iterator && _.isEmpty(obj)) return Infinity;
    var result = {computed : Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed < result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Shuffle an array.
  _.shuffle = function(obj) {
    var shuffled = [], rand;
    each(obj, function(value, index, list) {
      rand = Math.floor(Math.random() * (index + 1));
      shuffled[index] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, val, context) {
    var iterator = _.isFunction(val) ? val : function(obj) { return obj[val]; };
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value : value,
        criteria : iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria, b = right.criteria;
      if (a === void 0) return 1;
      if (b === void 0) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    }), 'value');
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = function(obj, val) {
    var result = {};
    var iterator = _.isFunction(val) ? val : function(obj) { return obj[val]; };
    each(obj, function(value, index) {
      var key = iterator(value, index);
      (result[key] || (result[key] = [])).push(value);
    });
    return result;
  };

  // Use a comparator function to figure out at what index an object should
  // be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator) {
    iterator || (iterator = _.identity);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >> 1;
      iterator(array[mid]) < iterator(obj) ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely convert anything iterable into a real, live array.
  _.toArray = function(obj) {
    if (!obj)                                     return [];
    if (_.isArray(obj))                           return slice.call(obj);
    if (_.isArguments(obj))                       return slice.call(obj);
    if (obj.toArray && _.isFunction(obj.toArray)) return obj.toArray();
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    return _.isArray(obj) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    return (n != null) && !guard ? slice.call(array, 0, n) : array[0];
  };

  // Returns everything but the last entry of the array. Especcialy useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if ((n != null) && !guard) {
      return slice.call(array, Math.max(array.length - n, 0));
    } else {
      return array[array.length - 1];
    }
  };

  // Returns everything but the first entry of the array. Aliased as `tail`.
  // Especially useful on the arguments object. Passing an **index** will return
  // the rest of the values in the array from that index onward. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = function(array, index, guard) {
    return slice.call(array, (index == null) || guard ? 1 : index);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, function(value){ return !!value; });
  };

  // Return a completely flattened version of an array.
  _.flatten = function(array, shallow) {
    return _.reduce(array, function(memo, value) {
      if (_.isArray(value)) return memo.concat(shallow ? value : _.flatten(value));
      memo[memo.length] = value;
      return memo;
    }, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator) {
    var initial = iterator ? _.map(array, iterator) : array;
    var results = [];
    // The `isSorted` flag is irrelevant if the array only contains two elements.
    if (array.length < 3) isSorted = true;
    _.reduce(initial, function (memo, value, index) {
      if (isSorted ? _.last(memo) !== value || !memo.length : !_.include(memo, value)) {
        memo.push(value);
        results.push(array[index]);
      }
      return memo;
    }, []);
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(_.flatten(arguments, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays. (Aliased as "intersect" for back-compat.)
  _.intersection = _.intersect = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.indexOf(other, item) >= 0;
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = _.flatten(slice.call(arguments, 1), true);
    return _.filter(array, function(value){ return !_.include(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var args = slice.call(arguments);
    var length = _.max(_.pluck(args, 'length'));
    var results = new Array(length);
    for (var i = 0; i < length; i++) results[i] = _.pluck(args, "" + i);
    return results;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i, l;
    if (isSorted) {
      i = _.sortedIndex(array, item);
      return array[i] === item ? i : -1;
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item);
    for (i = 0, l = array.length; i < l; i++) if (i in array && array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item) {
    if (array == null) return -1;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) return array.lastIndexOf(item);
    var i = array.length;
    while (i--) if (i in array && array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var len = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(len);

    while(idx < len) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Binding with arguments is also known as `curry`.
  // Delegates to **ECMAScript 5**'s native `Function.bind` if available.
  // We check for `func.bind` first, to fail fast when `func` is undefined.
  _.bind = function bind(func, context) {
    var bound, args;
    if (func.bind === nativeBind && nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Bind all of an object's methods to that object. Useful for ensuring that
  // all callbacks defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length == 0) funcs = _.functions(obj);
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time.
  _.throttle = function(func, wait) {
    var context, args, timeout, throttling, more, result;
    var whenDone = _.debounce(function(){ more = throttling = false; }, wait);
    return function() {
      context = this; args = arguments;
      var later = function() {
        timeout = null;
        if (more) func.apply(context, args);
        whenDone();
      };
      if (!timeout) timeout = setTimeout(later, wait);
      if (throttling) {
        more = true;
      } else {
        result = func.apply(context, args);
      }
      whenDone();
      throttling = true;
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      if (immediate && !timeout) func.apply(context, args);
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      return memo = func.apply(this, arguments);
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return function() {
      var args = [func].concat(slice.call(arguments, 0));
      return wrapper.apply(this, args);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    if (times <= 0) return func();
    return function() {
      if (--times < 1) { return func.apply(this, arguments); }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = nativeKeys || function(obj) {
    if (obj !== Object(obj)) throw new TypeError('Invalid object');
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys[keys.length] = key;
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    return _.map(obj, _.identity);
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      for (var prop in source) {
        obj[prop] = source[prop];
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var result = {};
    each(_.flatten(slice.call(arguments, 1)), function(key) {
      if (key in obj) result[key] = obj[key];
    });
    return result;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      for (var prop in source) {
        if (obj[prop] == null) obj[prop] = source[prop];
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function.
  function eq(a, b, stack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the Harmony `egal` proposal: http://wiki.ecmascript.org/doku.php?id=harmony:egal.
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a._chain) a = a._wrapped;
    if (b._chain) b = b._wrapped;
    // Invoke a custom `isEqual` method if one is provided.
    if (a.isEqual && _.isFunction(a.isEqual)) return a.isEqual(b);
    if (b.isEqual && _.isFunction(b.isEqual)) return b.isEqual(a);
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
               a.global == b.global &&
               a.multiline == b.multiline &&
               a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = stack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (stack[length] == a) return true;
    }
    // Add the first object to the stack of traversed objects.
    stack.push(a);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          // Ensure commutative equality for sparse arrays.
          if (!(result = size in a == size in b && eq(a[size], b[size], stack))) break;
        }
      }
    } else {
      // Objects with different constructors are not equivalent.
      if ('constructor' in a != 'constructor' in b || a.constructor != b.constructor) return false;
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], stack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    stack.pop();
    return result;
  }

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType == 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Is a given variable an arguments object?
  _.isArguments = function(obj) {
    return toString.call(obj) == '[object Arguments]';
  };
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Is a given value a function?
  _.isFunction = function(obj) {
    return toString.call(obj) == '[object Function]';
  };

  // Is a given value a string?
  _.isString = function(obj) {
    return toString.call(obj) == '[object String]';
  };

  // Is a given value a number?
  _.isNumber = function(obj) {
    return toString.call(obj) == '[object Number]';
  };

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return _.isNumber(obj) && isFinite(obj);
  };

  // Is the given value `NaN`?
  _.isNaN = function(obj) {
    // `NaN` is the only value for which `===` is not reflexive.
    return obj !== obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value a date?
  _.isDate = function(obj) {
    return toString.call(obj) == '[object Date]';
  };

  // Is the given value a regular expression?
  _.isRegExp = function(obj) {
    return toString.call(obj) == '[object RegExp]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Has own property?
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  // Run a function **n** times.
  _.times = function (n, iterator, context) {
    for (var i = 0; i < n; i++) iterator.call(context, i);
  };

  // Escape a string for HTML interpolation.
  _.escape = function(string) {
    return (''+string).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g,'&#x2F;');
  };

  // If the value of the named property is a function then invoke it;
  // otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return null;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object, ensuring that
  // they're correctly added to the OOP wrapper as well.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name){
      addToWrapper(name, _[name] = obj[name]);
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = idCounter++;
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /.^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    '\\': '\\',
    "'": "'",
    'r': '\r',
    'n': '\n',
    't': '\t',
    'u2028': '\u2028',
    'u2029': '\u2029'
  };

  for (var p in escapes) escapes[escapes[p]] = p;
  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;
  var unescaper = /\\(\\|'|r|n|t|u2028|u2029)/g;

  // Within an interpolation, evaluation, or escaping, remove HTML escaping
  // that had been previously added.
  var unescape = function(code) {
    return code.replace(unescaper, function(match, escape) {
      return escapes[escape];
    });
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    settings = _.defaults(settings || {}, _.templateSettings);

    // Compile the template source, taking care to escape characters that
    // cannot be included in a string literal and then unescape them in code
    // blocks.
    var source = "__p+='" + text
      .replace(escaper, function(match) {
        return '\\' + escapes[match];
      })
      .replace(settings.escape || noMatch, function(match, code) {
        return "'+\n_.escape(" + unescape(code) + ")+\n'";
      })
      .replace(settings.interpolate || noMatch, function(match, code) {
        return "'+\n(" + unescape(code) + ")+\n'";
      })
      .replace(settings.evaluate || noMatch, function(match, code) {
        return "';\n" + unescape(code) + "\n;__p+='";
      }) + "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __p='';" +
      "var print=function(){__p+=Array.prototype.join.call(arguments, '')};\n" +
      source + "return __p;\n";

    var render = new Function(settings.variable || 'obj', '_', source);
    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for build time
    // precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' +
      source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // The OOP Wrapper
  // ---------------

  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.
  var wrapper = function(obj) { this._wrapped = obj; };

  // Expose `wrapper.prototype` as `_.prototype`
  _.prototype = wrapper.prototype;

  // Helper function to continue chaining intermediate results.
  var result = function(obj, chain) {
    return chain ? _(obj).chain() : obj;
  };

  // A method to easily add functions to the OOP wrapper.
  var addToWrapper = function(name, func) {
    wrapper.prototype[name] = function() {
      var args = slice.call(arguments);
      unshift.call(args, this._wrapped);
      return result(func.apply(_, args), this._chain);
    };
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    wrapper.prototype[name] = function() {
      var wrapped = this._wrapped;
      method.apply(wrapped, arguments);
      var length = wrapped.length;
      if ((name == 'shift' || name == 'splice') && length === 0) delete wrapped[0];
      return result(wrapped, this._chain);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    wrapper.prototype[name] = function() {
      return result(method.apply(this._wrapped, arguments), this._chain);
    };
  });

  // Start chaining a wrapped Underscore object.
  wrapper.prototype.chain = function() {
    this._chain = true;
    return this;
  };

  // Extracts the result from a wrapped and chained object.
  wrapper.prototype.value = function() {
    return this._wrapped;
  };

}).call(this);

},{}]},{},[5])
(5)
});