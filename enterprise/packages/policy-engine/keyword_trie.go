package policyengine

import "strings"

type trieNode struct {
	children map[rune]*trieNode
	terminal bool
	word     string
}

type keywordTrie struct {
	root *trieNode
}

func newKeywordTrie(words []string) *keywordTrie {
	root := &trieNode{children: map[rune]*trieNode{}}
	for _, word := range words {
		clean := strings.TrimSpace(word)
		if clean == "" {
			continue
		}
		cursor := root
		for _, ch := range []rune(strings.ToLower(clean)) {
			next := cursor.children[ch]
			if next == nil {
				next = &trieNode{children: map[rune]*trieNode{}}
				cursor.children[ch] = next
			}
			cursor = next
		}
		cursor.terminal = true
		cursor.word = clean
	}
	return &keywordTrie{root: root}
}

func (t *keywordTrie) findAll(text string) []string {
	lowerRunes := []rune(strings.ToLower(text))
	hits := []string{}
	for i := 0; i < len(lowerRunes); i++ {
		cursor := t.root
		for j := i; j < len(lowerRunes); j++ {
			next := cursor.children[lowerRunes[j]]
			if next == nil {
				break
			}
			cursor = next
			if cursor.terminal {
				hits = append(hits, cursor.word)
			}
		}
	}
	return hits
}
