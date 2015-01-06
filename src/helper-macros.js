let if = macro {
    rule { $cond:expr then $then:expr else $else:expr } => {
        (($cond) ? ($then) : ($else))
    }
    // fall through
    rule { $rest ...} => { if $rest ...}
}

export if;
