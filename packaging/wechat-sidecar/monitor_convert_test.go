package main

import (
	"testing"

	ilink "github.com/openilink/openilink-sdk-go"
)

func TestConvertMessageImagePrefersMediaFullURL(t *testing.T) {
	evt := convertMessage(ilink.WeixinMessage{
		FromUserID: "u1",
		ItemList: []ilink.MessageItem{
			{
				Type: ilink.ItemImage,
				ImageItem: &ilink.ImageItem{
					URL:    "https://preview.example/thumb",
					AESKey: "top-level-key",
					Media: &ilink.CDNMedia{
						EncryptQueryParam: "eqp1",
						AESKey:            "media-key",
						FullURL:           "https://cdn.example/full",
					},
				},
			},
		},
	})
	if len(evt.Items) != 1 {
		t.Fatalf("items=%d", len(evt.Items))
	}
	item := evt.Items[0]
	if item.Type != int(ilink.ItemImage) {
		t.Fatalf("type=%d", item.Type)
	}
	if item.EQP != "eqp1" {
		t.Fatalf("eqp=%q", item.EQP)
	}
	if item.AESKey != "media-key" {
		t.Fatalf("aes=%q", item.AESKey)
	}
	if item.URL != "https://cdn.example/full" {
		t.Fatalf("url=%q", item.URL)
	}
}

func TestConvertMessageImageUsesThumbMediaWhenFullMissing(t *testing.T) {
	evt := convertMessage(ilink.WeixinMessage{
		FromUserID: "u1",
		ItemList: []ilink.MessageItem{
			{
				Type: ilink.ItemImage,
				ImageItem: &ilink.ImageItem{
					ThumbMedia: &ilink.CDNMedia{
						EncryptQueryParam: "thumb-eqp",
						AESKey:            "thumb-key",
						FullURL:           "https://cdn.example/thumb",
					},
				},
			},
		},
	})
	if len(evt.Items) != 1 {
		t.Fatalf("items=%d", len(evt.Items))
	}
	item := evt.Items[0]
	if item.EQP != "thumb-eqp" {
		t.Fatalf("eqp=%q", item.EQP)
	}
	if item.AESKey != "thumb-key" {
		t.Fatalf("aes=%q", item.AESKey)
	}
	if item.URL != "https://cdn.example/thumb" {
		t.Fatalf("url=%q", item.URL)
	}
}

func TestConvertMessageExtractsQuotedImage(t *testing.T) {
	evt := convertMessage(ilink.WeixinMessage{
		FromUserID: "u1",
		ItemList: []ilink.MessageItem{
			{
				Type:     ilink.ItemText,
				TextItem: &ilink.TextItem{Text: "把这个论文发给我"},
				RefMsg: &ilink.RefMessage{
					Title: "图片",
					MessageItem: &ilink.MessageItem{
						Type: ilink.ItemImage,
						ImageItem: &ilink.ImageItem{
							Media: &ilink.CDNMedia{
								EncryptQueryParam: "ref-eqp",
								AESKey:            "ref-key",
							},
						},
					},
				},
			},
		},
	})
	if evt.Text != "把这个论文发给我" {
		t.Fatalf("text=%q", evt.Text)
	}
	if len(evt.Items) != 2 {
		t.Fatalf("items=%d", len(evt.Items))
	}
	ref := evt.Items[1]
	if ref.Type != int(ilink.ItemImage) || ref.EQP != "ref-eqp" {
		t.Fatalf("ref=%+v", ref)
	}
}

func TestConvertMessageImageFallsBackToItemAESKey(t *testing.T) {
	evt := convertMessage(ilink.WeixinMessage{
		FromUserID: "u1",
		ItemList: []ilink.MessageItem{
			{
				Type: ilink.ItemImage,
				ImageItem: &ilink.ImageItem{
					URL:    "https://preview.example/thumb",
					AESKey: "top-level-key",
				},
			},
		},
	})
	if len(evt.Items) != 1 {
		t.Fatalf("items=%d", len(evt.Items))
	}
	item := evt.Items[0]
	if item.EQP != "" {
		t.Fatalf("eqp=%q", item.EQP)
	}
	if item.AESKey != "top-level-key" {
		t.Fatalf("aes=%q", item.AESKey)
	}
	if item.URL != "https://preview.example/thumb" {
		t.Fatalf("url=%q", item.URL)
	}
}
