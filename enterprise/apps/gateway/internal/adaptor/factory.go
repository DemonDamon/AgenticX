package adaptor

// Factory 按 providerType 选择 Adaptor。
type Factory struct {
	openai Adaptor
	claude Adaptor
	gemini Adaptor
}

func NewFactory(openaiAdaptor Adaptor) *Factory {
	if openaiAdaptor == nil {
		openaiAdaptor = NewOpenAIAdaptor()
	}
	return &Factory{
		openai: openaiAdaptor,
		claude: NewClaudeAdaptor(),
		gemini: NewGeminiAdaptor(),
	}
}

func (f *Factory) OpenAI() Adaptor {
	if f == nil {
		return NewOpenAIAdaptor(nil)
	}
	return f.openai
}
