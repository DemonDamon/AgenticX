package audit

// EventWriter persists audit events. Implementations compute / preserve checksum chain on *Event.
type EventWriter interface {
	Write(event *Event) error
}
