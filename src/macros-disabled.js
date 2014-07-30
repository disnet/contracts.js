var _c;
let import = macro {
    rule { @ from $lib:lit } => {
        _c = <%= lib %>
    }
    rule { $rest ... } => {
        import $rest ...
    }
}
export import;

macro stringify {
    case {_ ($toks ...) } => {
        var toks = #{$toks ...}[0].token.inner;

        function traverse(stx) {
            return stx.map(function(s) {
                if (s.token.inner) {
                    return s.token.value[0] + traverse(s.token.inner) + s.token.value[1];
                }
                return s.token.value;
            }).join(" ");
        }

        var toksStr = traverse(toks);
        letstx $str = [makeValue(toksStr, #{here})];
        return #{$str}
    }
}

macro base_contract {
    rule { $name } => { _c.$name }
}

macro function_contract {
    rule { ($dom:named_contract (,) ...) -> $range:named_contract | $guard:expr } => {
        _c.fun([$dom$contract (,) ...], $range$contract, {
            dependency: function($dom$name (,) ..., $range$name) {
                return $guard;
            },
            namesStr: [$(stringify (($dom$name))) (,) ..., stringify (($range$name))],
            dependencyStr: stringify ($guard)
        })
    }
    rule { ($dom:any_contract (,) ...) -> $range:any_contract } => {
        _c.fun([$dom (,) ...], $range)
    }
}

macro object_contract {
    rule { {
        $($prop $[:] $contract:any_contract) (,) ...
    } } => {
        _c.object({
            $($prop : $contract) (,) ...
        })
    }
    // proxied objects
    rule { !{
        $($prop $[:] $contract:any_contract) (,) ...
    } } => {
        _c.object({
            $($prop : $contract) (,) ...
        }, {proxy: true})
    }
}

macro array_contract {
    rule { [
        $contracts:any_contract (,) ...
    ] } => {
        _c.array([$contracts (,) ...])
    }
    // proxied arrays
    rule { ![
        $contracts:any_contract (,) ...
    ] } => {
        _c.array([$contracts (,) ...], {proxy: true})
    }
}

macro repeat_contract {
    rule {$[...] $contract:any_contract } => {
        _c.repeat($contract)
    }
}

macro optional_contract {
    rule {
        opt $contract:any_contract
    } => {
        _c.optional($contract)
    }
}

macro non_or_contract {
    rule { $contract:function_contract } => { $contract }
    rule { $contract:object_contract }   => { $contract }
    rule { $contract:array_contract }    => { $contract }
    rule { $contract:repeat_contract }   => { $contract }
    rule { $contract:optional_contract } => { $contract }
    rule { $contract:base_contract }     => { $contract }
}

macro or_contract {
    rule { $left:non_or_contract or $right:any_contract } => {
        _c.or($left, $right)
    }
}

macro any_contract {
    rule { $contract:or_contract }     => { $contract }
    rule { $contract:non_or_contract } => { $contract }
}


let @ = macro {
    case {_
          let $contractName = $contract:any_contract
    } => {
        return #{
            _c.$contractName = $contract;
        }
    }

    case {_
        $contracts:function_contract
        function $name ($params ...) { $body ...}
    } => {
        return #{
            function $name ($params ...) {
                return $body ...
            }
        }
    }
}
export @;
